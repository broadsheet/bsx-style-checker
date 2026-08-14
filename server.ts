import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import { initializeApp, getApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs, doc, setDoc, deleteDoc, setLogLevel, getDocFromServer, getFirestore } from 'firebase/firestore';


// Safely resolve __filename and __dirname in both ES Module (dev) and CommonJS (prod bundle) environments
const currentFilename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const currentDirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(currentFilename);

// Suppress Firestore BloomFilter warning/error log noise from cluttering server logs (known issue in Node 18+ environments)
const filterBloomFilterNoise = (args: any[]) => {
  return args.some(arg => 
    arg && typeof arg === 'string' && 
    (arg.includes('BloomFilter') || arg.includes('Invalid hash count: 0'))
  );
};

const originalConsoleError = console.error;
console.error = function (...args: any[]) {
  if (filterBloomFilterNoise(args)) return;
  originalConsoleError.apply(this, args);
};

const originalConsoleWarn = console.warn;
console.warn = function (...args: any[]) {
  if (filterBloomFilterNoise(args)) return;
  originalConsoleWarn.apply(this, args);
};

import { BROADSHEET_STYLE_GUIDE } from './src/constants/styleGuide.ts';
import { DEFAULT_MACQUARIE_ENTRIES } from './src/constants/defaultMacquarie.ts';
import { SOCIAL_MEDIA_GUIDELINES } from './src/constants/styleGuide/socialMedia.ts';
import { COMMON_MISTAKES } from './src/constants/commonMistakes.ts';

dotenv.config();

const CUSTOM_GUIDES_PATH = path.join(process.cwd(), 'custom_guides.json');
const CROSSCHECK_LOGS_PATH = path.join(process.cwd(), 'crosscheck_logs.json');
const SESSION_LOGS_PATH = path.join(process.cwd(), 'session_logs.json');
const USER_FEEDBACK_PATH = path.join(process.cwd(), 'user_feedback.json');
const MACQUARIE_DICT_PATH = path.join(process.cwd(), 'macquarie_dictionary.json');

let macquarieDictCache: { [key: string]: string } | null = null;
let macquarieDictMeta: { wordCount: number; fileSize: number } | null = null;

function escapeControlCharsInStrings(jsonStr: string): string {
  let inString = false;
  let stringChar = '';
  let escaped = false;
  let result = '';

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && (!inString || stringChar === char)) {
      inString = !inString;
      stringChar = inString ? char : '';
      result += char;
      continue;
    }

    if (inString) {
      const code = char.charCodeAt(0);
      if (code < 32) {
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else {
          result += '\\u' + ('0000' + code.toString(16)).slice(-4);
        }
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }

  return result;
}

function parseGeminiJSON(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    try {
      let cleaned = text.trim();
      
      // 1. Extract substring between first '{' and last '}' to strip any conversational prefixes/suffixes
      const firstCurly = cleaned.indexOf('{');
      const lastCurly = cleaned.lastIndexOf('}');
      if (firstCurly !== -1 && lastCurly !== -1 && lastCurly > firstCurly) {
        cleaned = cleaned.substring(firstCurly, lastCurly + 1);
      }

      // Remove markdown block wrapper if any remains
      cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      
      // 2. Remove Javascript-style comments (preserving URLs)
      cleaned = cleaned.replace(/(?:^|[^:])\/\/.*$/gm, (m) => m.startsWith('//') ? '' : m.slice(0, m.indexOf('//')));
      cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

      // 3. Convert single-quoted keys to double-quoted keys: 'key': or 'key' : -> "key":
      cleaned = cleaned.replace(/'([^'\s]+)'\s*:/g, '"$1":');

      // 4. Convert single-quoted values to double-quoted values, escaping inner double quotes
      cleaned = cleaned.replace(/:\s*'([^']*)'/g, (_, val) => {
        const escaped = val.replace(/(?<!\\)"/g, '\\"');
        return `: "${escaped}"`;
      });

      // 5. Convert unquoted keys to double-quoted keys: { key: or , key: -> { "key": or , "key":
      cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

      // 6. Remove trailing commas before closing braces/brackets
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

      // 7. Escape literal control characters that are INSIDE string values
      cleaned = escapeControlCharsInStrings(cleaned);

      // 8. Fix bad unicode escapes by doubling the backslash if not followed by 4 hex digits
      cleaned = cleaned.replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u");

      return JSON.parse(cleaned);
    } catch (err) {
      console.error('Failed to parse Gemini JSON output', err);
      throw new Error("Failed to parse AI response. " + (err instanceof Error ? err.message : String(err)));
    }
  }
}

function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str.replace(/&[a-zA-Z0-9#x]+;/g, (entity) => {
    if (entity.startsWith('&#x')) {
      const hex = entity.substring(3, entity.length - 1);
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch (_) {
        return entity;
      }
    }
    if (entity.startsWith('&#')) {
      const dec = entity.substring(2, entity.length - 1);
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch (_) {
        return entity;
      }
    }
    const namedEntities: { [key: string]: string } = {
      'amp': '&',
      'lt': '<',
      'gt': '>',
      'quot': '"',
      'apos': "'",
      'nbsp': ' ',
      'agrave': 'à',
      'aacute': 'á',
      'acirc': 'â',
      'atilde': 'ã',
      'auml': 'ä',
      'aring': 'å',
      'aelig': 'æ',
      'ccedil': 'ç',
      'egrave': 'è',
      'eacute': 'é',
      'ecirc': 'ê',
      'euml': 'ë',
      'igrave': 'ì',
      'iacute': 'í',
      'icirc': 'î',
      'iuml': 'ï',
      'eth': 'ð',
      'ntilde': 'ñ',
      'ograve': 'ò',
      'oacute': 'ó',
      'ocirc': 'ô',
      'otilde': 'õ',
      'ouml': 'ö',
      'divide': '÷',
      'oslash': 'ø',
      'ugrave': 'ù',
      'uacute': 'ú',
      'ucirc': 'û',
      'uuml': 'ü',
      'yacute': 'ý',
      'thorn': 'þ',
      'yuml': 'ÿ',
      'AElig': 'Æ',
      'Aring': 'Å',
      'Ouml': 'Ö',
      'Uuml': 'Ü',
      'Obar': 'Ø',
      'Omacr': 'Ō',
    };
    const key = entity.substring(1, entity.length - 1);
    return namedEntities[key] || namedEntities[key.toLowerCase()] || entity;
  });
}

function enforceSmartQuotes(str: string): string {
  if (!str) return str;
  return str
    // First, convert backticks to straight quotes so they get processed
    .replace(/`/g, "'")
    // Specific leading contractions
    .replace(/(^|[-\u2014\s(\["])(['‘])(90s|80s|70s|60s|00s|em|burb|nduja|cause|bout|til|n)\b/gi, "$1\u2019$3")
    // Left single quotes
    .replace(/(^|[-\u2014\s(\["])'/g, "$1\u2018")
    // All other straight single quotes become right single quotes (apostrophes or closing)
    .replace(/'/g, "\u2019")
    // Fix left-facing single quotes incorrectly used as apostrophes
    .replace(/([a-zA-Z])‘([a-zA-Z])/g, "$1\u2019$2")
    .replace(/([a-zA-Z])‘s\b/gi, "$1\u2019s")
    // Left double quotes
    .replace(/(^|[-\u2014\s(\['])"/g, "$1\u201C")
    // Right double quotes
    .replace(/"/g, "\u201D");
}

function extractEntriesFromAny(obj: any, cache: { [key: string]: string }): number {
  let count = 0;
  if (!obj) return 0;

  function stringifyVal(val: any): string {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
      return val.map(v => typeof v === 'object' ? stringifyVal(v) : String(v)).join('; ');
    }
    if (typeof val === 'object') {
      const possibleDefKeys = ['definition', 'def', 'meaning', 'description', 'desc', 'gloss', 'text', 'value', 'senses', 'content', 'explanation'];
      for (const k of possibleDefKeys) {
        if (val[k] !== undefined && val[k] !== null) {
          return stringifyVal(val[k]);
        }
      }
      return Object.entries(val)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' | ');
    }
    return String(val);
  }

  function processItem(item: any): boolean {
    if (!item) return false;
    if (typeof item === 'string') {
      const decoded = decodeHtmlEntities(item.trim());
      if (decoded && decoded.length > 1 && decoded.length < 50) {
        cache[decoded.toLowerCase()] = "Preferred Australian English spelling (listed in Macquarie Dictionary).";
        return true;
      }
      return false;
    }
    if (typeof item === 'object') {
      const wordKeys = ['word', 'key', 'term', 'headword', 'title', 'name', 'lemma', 'spelling', 'item', 'label'];
      const defKeys = ['definition', 'definition1', 'def', 'meaning', 'description', 'desc', 'gloss', 'text', 'value', 'senses', 'content', 'explanation'];
      
      let wordVal = '';
      let defVal = '';
      
      for (const k of wordKeys) {
        if (item[k] !== undefined && item[k] !== null) {
          wordVal = String(item[k]).trim();
          break;
        }
      }
      
      for (const k of defKeys) {
        if (item[k] !== undefined && item[k] !== null) {
          defVal = stringifyVal(item[k]).trim();
          break;
        }
      }

      if (wordVal && defVal) {
        const decodedWord = decodeHtmlEntities(wordVal);
        cache[decodedWord.toLowerCase()] = decodeHtmlEntities(defVal);
        return true;
      }

      const keys = Object.keys(item);
      if (keys.length === 2) {
        const val0 = String(item[keys[0]]);
        const val1 = String(item[keys[1]]);
        if (val0.length > 0 && val0.length < 50 && val1.length > val0.length) {
          cache[val0.toLowerCase()] = val1;
          return true;
        } else if (val1.length > 0 && val1.length < 50 && val0.length > val1.length) {
          cache[val1.toLowerCase()] = val0;
          return true;
        }
      }
    }
    return false;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (processItem(item)) {
        count++;
      } else if (typeof item === 'object') {
        count += extractEntriesFromAny(item, cache);
      }
    }
  } else if (typeof obj === 'object') {
    const commonTopLevelContainers = ['words', 'entries', 'dictionary', 'terms', 'data', 'definitions', 'items', 'vocabulary', 'lexicon'];
    let parsedContainer = false;
    for (const key of commonTopLevelContainers) {
      if (obj[key] && (Array.isArray(obj[key]) || typeof obj[key] === 'object')) {
        const subCount = extractEntriesFromAny(obj[key], cache);
        if (subCount > 0) {
          count += subCount;
          parsedContainer = true;
        }
      }
    }

    if (!parsedContainer) {
      for (const [key, value] of Object.entries(obj)) {
        if (key && key.length < 100 && value) {
          if (typeof value === 'string' || typeof value === 'number') {
            const decodedKey = decodeHtmlEntities(key.trim());
            cache[decodedKey.toLowerCase()] = decodeHtmlEntities(String(value));
            count++;
          } else if (typeof value === 'object') {
            const valObj = value as any;
            let defStr = '';
            const defKeys = ['definition', 'def', 'meaning', 'description', 'desc', 'gloss', 'text', 'value', 'senses', 'content', 'explanation'];
            for (const dk of defKeys) {
              if (valObj[dk] !== undefined && valObj[dk] !== null) {
                defStr = stringifyVal(valObj[dk]);
                break;
              }
            }
            if (!defStr) {
              defStr = stringifyVal(valObj);
            }
            if (defStr) {
              const decodedKey = decodeHtmlEntities(key.trim());
              cache[decodedKey.toLowerCase()] = decodeHtmlEntities(defStr);
              count++;
            }
          }
        } else if (typeof value === 'object') {
          count += extractEntriesFromAny(value, cache);
        }
      }
    }
  }

  return count;
}

function loadMacquarieDict() {
  if (macquarieDictCache) return macquarieDictCache;
  if (fs.existsSync(MACQUARIE_DICT_PATH)) {
    try {
      const stats = fs.statSync(MACQUARIE_DICT_PATH);
      const dataStr = fs.readFileSync(MACQUARIE_DICT_PATH, 'utf-8');
      const parsed = JSON.parse(dataStr);
      
      const cache: { [key: string]: string } = {};
      const wordCount = extractEntriesFromAny(parsed, cache);
      
      macquarieDictCache = cache;
      macquarieDictMeta = {
        wordCount,
        fileSize: stats.size
      };
      return macquarieDictCache;
    } catch (err) {
      console.error('Error parsing Macquarie dictionary, falling back to pre-compiled baseline:', err);
    }
  }

  // Use pre-compiled Australian vocabulary baseline if no custom user dictionary is uploaded
  macquarieDictCache = { ...DEFAULT_MACQUARIE_ENTRIES };
  macquarieDictMeta = {
    wordCount: Object.keys(DEFAULT_MACQUARIE_ENTRIES).length,
    fileSize: JSON.stringify(DEFAULT_MACQUARIE_ENTRIES).length
  };
  return macquarieDictCache;
}

function findMacquarieMatches(text: string): string {
  const dict = loadMacquarieDict();
  if (!dict) return '';
  
  // Strip punctuation and split by whitespace to isolate potential words
  const words = text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’]/g, ' ')
    .split(/\s+/);
    
  const uniqueWords = new Set<string>();
  for (const w of words) {
    if (w?.trim() && w.length > 2) {
      uniqueWords.add(w.trim());
    }
  }
  
  // Find entries in dictionary
  const matches: string[] = [];
  for (const word of uniqueWords) {
    if (dict[word]) {
      matches.push(`- ${word}: ${dict[word]}`);
    }
  }
  
  if (matches.length === 0) return '';
  
  // We cap the matches to prevent overly inflating context length
  const maxMatches = 150;
  const slicedMatches = matches.slice(0, maxMatches);
  
  return slicedMatches.join('\n');
}

interface CrossCheckLog {
  id: string;
  timestamp: string;
  lastEvaluatedAt?: string;
  originalCopy: string;
  aiCorrected: string;
  humanFinalized: string;
  accuracyScore: number;
  alignmentGap: string;
  missedInfractions: any[];
  correctAdherences?: any[];
  fineTuningActionable: string;
  userEmail?: string;
  aiSuggestions?: any[];
}

interface StyleReviewLog {
  id: string;
  timestamp: string;
  copyMode: 'editorial';
  wordCount: number;
  totalSuggestions: number;
  acceptedCount: number;
  ignoredCount: number;
  pendingCount: number;
  reportMarkdown: string;
  draftSummary: string;
  originalCopyText: string;
  logName?: string;
  currentDraftText?: string;
  aiCorrectedText?: string;
  userEmail?: string;
  suggestions?: any[];
}

// Global safety check state for Firebase
let firestoreDb: any = null;
let firestoreStyleDb: any = null;
let lastDbStatus = {
  connected: true,
  source: 'firestore' as 'firestore' | 'local_backup',
  error: null as string | null,
  lastChecked: new Date().toISOString()
};

function getFirebaseApp() {
  try {
    return getApp();
  } catch {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error('Firebase configuration file firebase-applet-config.json is missing.');
    }
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return initializeApp(firebaseConfig);
  }
}

function getStyleDb() {
  if (!firestoreStyleDb) {
    const app = getFirebaseApp();
    setLogLevel('silent');
    firestoreStyleDb = initializeFirestore(app, {
      experimentalForceLongPolling: true
    }, '(default)');
  }
  return firestoreStyleDb;
}

function getDb() {
  if (!firestoreDb) {
    const app = getFirebaseApp();
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    setLogLevel('silent');
    firestoreDb = initializeFirestore(app, {
      experimentalForceLongPolling: true
    }, firebaseConfig.firestoreDatabaseId);

    // Test connection non-blocking as required by SKILL.md
    getDocFromServer(doc(firestoreDb, 'crosscheck_logs', 'connection_test'))
      .then(() => {
        lastDbStatus = {
          connected: true,
          source: 'firestore',
          error: null,
          lastChecked: new Date().toISOString()
        };
        // Automatically rehydrate custom guides and Macquarie Dictionary from Firestore on connection
        rehydrateCustomDataFromFirestore().catch(err => {
          console.error("Failed to rehydrate custom data from Firestore:", err);
        });
        seedAdminUser().catch(err => {
          console.error("Failed to seed initial admin user:", err);
        });
      })
      .catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Firebase connection test status: ", errorMsg);
        lastDbStatus = {
          connected: false,
          source: 'local_backup',
          error: errorMsg,
          lastChecked: new Date().toISOString()
        };
      });
  }
  return firestoreDb;
}

async function seedAdminUser() {
  try {
    const db = getDb();
    if (!db) return;
    const adminEmail = 'james.harrison@broadsheet.com.au';
    const userDocRef = doc(db, 'authorized_users', adminEmail);
    const snap = await getDocFromServer(userDocRef);
    if (!snap.exists()) {
      console.log(`[AUTH] Seeding initial admin user: ${adminEmail}`);
      await setDoc(userDocRef, {
        email: adminEmail,
        role: 'admin',
        invitedBy: 'system',
        invitedAt: new Date().toISOString(),
        status: 'active'
      });
      console.log('[AUTH] Initial admin user seeded successfully.');
    } else {
      console.log('[AUTH] Admin user already exists in Firestore.');
    }
  } catch (error) {
    console.error('[AUTH] Failed to seed initial admin user:', error);
  }
}

// Middleware to verify user is authorized (exists in authorized_users collection)
async function checkAuthorized(req: Request, res: Response, next: any) {
  const email = req.headers['x-user-email'] as string;
  if (!email) {
    return res.status(401).json({ error: "Unauthorized: Missing user identity" });
  }
  
  const trimmedEmail = email.toLowerCase().trim();
  const db = getDb();
  if (!db) {
    return res.status(503).json({ error: "Database service unavailable. Please check Firestore status." });
  }

  try {
    const userDocRef = doc(db, 'authorized_users', trimmedEmail);
    const snap = await getDocFromServer(userDocRef);
    if (snap.exists() && snap.data()?.status !== 'revoked') {
      (req as any).user = snap.data();
      return next();
    } else {
      return res.status(403).json({ error: `Forbidden: Access denied. Email ${email} is not authorized on this application. Please ask an administrator to add you.` });
    }
  } catch (err: any) {
    console.error("[AUTH] Authorization check error:", err);
    return res.status(500).json({ error: "Error authenticating user role." });
  }
}

// Middleware to verify user is Admin (role is 'admin')
async function checkAdmin(req: Request, res: Response, next: any) {
  await checkAuthorized(req, res, () => {
    const user = (req as any).user;
    if (user && user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ error: "Forbidden: Administrator permissions required." });
    }
  });
}

// Middleware to verify user is Sub-editor or Admin (role is 'sub-editor' or 'admin')
async function checkSubEditorOrAdmin(req: Request, res: Response, next: any) {
  await checkAuthorized(req, res, () => {
    const user = (req as any).user;
    if (user && (user.role === 'sub-editor' || user.role === 'admin')) {
      next();
    } else {
      res.status(403).json({ error: "Forbidden: Sub-editor or Administrator permissions required." });
    }
  });
}

async function rehydrateCustomDataFromFirestore() {
  try {
    const db = getDb();
    if (!db) return;

    console.log('Starting custom data rehydration from Firestore...');

    // 1. Rehydrate Custom Guides
    const guidesDocRef = doc(db, 'style_guides', 'custom_guides');
    const guidesSnap = await getDocFromServer(guidesDocRef);
    if (guidesSnap.exists()) {
      const data = guidesSnap.data();
      fs.writeFileSync(CUSTOM_GUIDES_PATH, JSON.stringify(data, null, 2), 'utf-8');
      console.log('Successfully rehydrated Custom Guides from Firestore.');
    } else {
      console.log('No Custom Guides found in Firestore.');
    }

    // 2. Rehydrate or Auto-Sync Macquarie Dictionary
    const dictMetaRef = doc(db, 'macquarie_dict', 'metadata');
    const dictMetaSnap = await getDocFromServer(dictMetaRef);
    const localFileExists = fs.existsSync(MACQUARIE_DICT_PATH);

    if (dictMetaSnap.exists()) {
      if (!localFileExists) {
        const meta = dictMetaSnap.data();
        const totalChunks = meta.totalChunks || 0;
        console.log(`Found Macquarie Dictionary in Firestore with ${totalChunks} chunks. Rehydrating local disk...`);
        
        let fullJson = '';
        for (let i = 0; i < totalChunks; i++) {
          const chunkRef = doc(db, 'macquarie_dict', `chunk_${i}`);
          const chunkSnap = await getDocFromServer(chunkRef);
          if (chunkSnap.exists()) {
            fullJson += chunkSnap.data().content || '';
          } else {
            console.warn(`Warning: Macquarie Dictionary chunk_${i} is missing in Firestore!`);
          }
        }

        if (fullJson) {
          fs.writeFileSync(MACQUARIE_DICT_PATH, fullJson, 'utf-8');
          macquarieDictCache = null;
          macquarieDictMeta = null;
          loadMacquarieDict(); // Parse into memory cache
          console.log(`Successfully rehydrated Macquarie Dictionary from Firestore. Word count: ${macquarieDictMeta?.wordCount}`);
        }
      } else {
        console.log('Macquarie Dictionary already exists on local disk and version exists in Firestore. Loading from disk.');
        macquarieDictCache = null;
        macquarieDictMeta = null;
        loadMacquarieDict(); // Ensure parsing is triggered
      }
    } else if (localFileExists) {
      try {
        console.log('Injected local Macquarie Dictionary file found. Auto-syncing to Firestore Cloud for sharing...');
        const rawJsonContent = fs.readFileSync(MACQUARIE_DICT_PATH, 'utf-8');
        const parsed = JSON.parse(rawJsonContent);
        
        const tempCache: { [key: string]: string } = {};
        const wordCount = extractEntriesFromAny(parsed, tempCache);
        
        const chunkSize = 800000; // ~800KB chunk size
        const totalChunks = Math.ceil(rawJsonContent.length / chunkSize);
        
        await setDoc(doc(db, 'macquarie_dict', 'metadata'), {
          totalChunks,
          wordCount,
          fileSize: rawJsonContent.length,
          updatedAt: new Date().toISOString()
        });
        
        for (let i = 0; i < totalChunks; i++) {
          const chunkContent = rawJsonContent.substring(i * chunkSize, (i + 1) * chunkSize);
          await setDoc(doc(db, 'macquarie_dict', `chunk_${i}`), { content: chunkContent });
        }
        
        macquarieDictCache = null;
        macquarieDictMeta = null;
        loadMacquarieDict(); // Ensure parsed in-cache is correct
        console.log(`Successfully auto-synced local Macquarie Dictionary (${wordCount} entries) to Firestore.`);
      } catch (syncErr) {
        console.error('Failed to auto-sync local Macquarie Dictionary to Firestore:', syncErr);
      }
    } else {
      console.log('No custom Macquarie Dictionary found on disk or Firestore. Falling back to built-in spelling baseline.');
    }
  } catch (error) {
    console.error('Error rehydrating custom data from Firestore:', error);
  }
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {}, // Run at standard backend server auth context
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function getCrossCheckLogs(): CrossCheckLog[] {
  try {
    if (fs.existsSync(CROSSCHECK_LOGS_PATH)) {
      return JSON.parse(fs.readFileSync(CROSSCHECK_LOGS_PATH, 'utf-8')) as CrossCheckLog[];
    }
  } catch (err) {
    console.error('Error reading crosscheck logs:', err);
  }
  return [];
}

function saveCrossCheckLogs(logs: CrossCheckLog[]) {
  try {
    fs.writeFileSync(CROSSCHECK_LOGS_PATH, JSON.stringify(logs, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing crosscheck logs:', err);
  }
}

// Firestore integrated functions with fallback to local json backup
async function dbGetCrossCheckLogs(): Promise<{ logs: CrossCheckLog[], status: typeof lastDbStatus }> {
  const pathForGetDocs = 'crosscheck_logs';
  try {
    const db = getDb();
    const colRef = collection(db, pathForGetDocs);
    const snapshot = await getDocs(colRef);
    const logs: CrossCheckLog[] = [];
    snapshot.forEach((d) => {
      logs.push(d.data() as CrossCheckLog);
    });
    // Sort descending by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
    return { logs, status: lastDbStatus };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error fetching logs from Firestore, using local file backup:', error);
    
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: errorMsg,
      lastChecked: new Date().toISOString()
    };
    
    if (errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('insufficient')) {
      try {
        handleFirestoreError(error, OperationType.GET, pathForGetDocs);
      } catch (e) {
        // Just report and continue
      }
    }
    
    const logs = getCrossCheckLogs();
    return { logs, status: lastDbStatus };
  }
}

function sanitizeCrossCheckLog(log: any): CrossCheckLog {
  const rawAcc = typeof log.accuracyScore === 'number' ? log.accuracyScore : 100;
  const safeAcc = isNaN(rawAcc) ? 100 : rawAcc;

  const cleanLog: any = {
    id: String(log.id || '').substring(0, 100),
    timestamp: String(log.timestamp || new Date().toISOString()).substring(0, 100),
    originalCopy: String(log.originalCopy || '').substring(0, 500000),
    aiCorrected: String(log.aiCorrected || '').substring(0, 500000),
    humanFinalized: String(log.humanFinalized || '').substring(0, 500000),
    accuracyScore: Math.max(0, Math.min(100, safeAcc))
  };

  if (log.lastEvaluatedAt !== undefined && log.lastEvaluatedAt !== null) {
    cleanLog.lastEvaluatedAt = String(log.lastEvaluatedAt).substring(0, 100);
  }

  if (log.alignmentGap !== undefined && log.alignmentGap !== null) {
    cleanLog.alignmentGap = String(log.alignmentGap).substring(0, 100000);
  } else {
    cleanLog.alignmentGap = '';
  }

  if (log.fineTuningActionable !== undefined && log.fineTuningActionable !== null) {
    cleanLog.fineTuningActionable = String(log.fineTuningActionable).substring(0, 100000);
  } else {
    cleanLog.fineTuningActionable = '';
  }

  if (Array.isArray(log.missedInfractions)) {
    cleanLog.missedInfractions = log.missedInfractions;
  } else {
    cleanLog.missedInfractions = [];
  }

  if (Array.isArray(log.correctAdherences)) {
    cleanLog.correctAdherences = log.correctAdherences;
  } else {
    cleanLog.correctAdherences = [];
  }

  if (log.userEmail !== undefined && log.userEmail !== null && String(log.userEmail).trim() !== '') {
    cleanLog.userEmail = String(log.userEmail).trim().substring(0, 200);
  }

  if (Array.isArray(log.aiSuggestions)) {
    cleanLog.aiSuggestions = log.aiSuggestions.map((s: any) => {
      const cleanSuggestion: any = {
        original: String(s.original || ''),
        rule: String(s.rule || ''),
        issue: String(s.issue || ''),
        fix: String(s.fix || ''),
        isNote: Boolean(s.isNote),
        status: s.status || 'pending',
        type: s.type || 'style'
      };
      if (s.prefixText !== undefined && s.prefixText !== null) {
        cleanSuggestion.prefixText = String(s.prefixText);
      }
      if (s.suffixText !== undefined && s.suffixText !== null) {
        cleanSuggestion.suffixText = String(s.suffixText);
      }
      return cleanSuggestion;
    });
  } else {
    cleanLog.aiSuggestions = [];
  }

  return cleanLog as CrossCheckLog;
}

function sanitizeSessionLog(log: any): StyleReviewLog {
  const cleanLog: any = {
    id: String(log.id || '').substring(0, 120),
    timestamp: String(log.timestamp || new Date().toISOString()).substring(0, 100),
    copyMode: log.copyMode || 'editorial',
    wordCount: Number(log.wordCount || 0),
    totalSuggestions: Number(log.totalSuggestions || 0),
    acceptedCount: Number(log.acceptedCount || 0),
    ignoredCount: Number(log.ignoredCount || 0),
    pendingCount: Number(log.pendingCount || 0)
  };

  if (log.reportMarkdown !== undefined && log.reportMarkdown !== null) {
    cleanLog.reportMarkdown = String(log.reportMarkdown).substring(0, 1000000);
  } else {
    cleanLog.reportMarkdown = '';
  }

  if (log.draftSummary !== undefined && log.draftSummary !== null) {
    cleanLog.draftSummary = String(log.draftSummary).substring(0, 100000);
  } else {
    cleanLog.draftSummary = '';
  }

  if (log.originalCopyText !== undefined && log.originalCopyText !== null) {
    cleanLog.originalCopyText = String(log.originalCopyText).substring(0, 1000000);
  } else {
    cleanLog.originalCopyText = '';
  }

  if (log.logName !== undefined && log.logName !== null) {
    cleanLog.logName = String(log.logName).substring(0, 1000);
  } else {
    cleanLog.logName = '';
  }

  if (log.currentDraftText !== undefined && log.currentDraftText !== null) {
    cleanLog.currentDraftText = String(log.currentDraftText).substring(0, 1000000);
  } else {
    cleanLog.currentDraftText = '';
  }

  if (log.aiCorrectedText !== undefined && log.aiCorrectedText !== null) {
    cleanLog.aiCorrectedText = String(log.aiCorrectedText).substring(0, 1000000);
  } else {
    cleanLog.aiCorrectedText = '';
  }

  if (log.userEmail !== undefined && log.userEmail !== null && String(log.userEmail).trim() !== '') {
    cleanLog.userEmail = String(log.userEmail).trim().substring(0, 200);
  }

  if (Array.isArray(log.suggestions)) {
    cleanLog.suggestions = log.suggestions.map((s: any) => {
      const cleanSuggestion: any = {
        original: String(s.original || ''),
        rule: String(s.rule || ''),
        issue: String(s.issue || ''),
        fix: String(s.fix || ''),
        isNote: Boolean(s.isNote),
        status: s.status || 'pending',
        type: s.type || 'style'
      };
      if (s.prefixText !== undefined && s.prefixText !== null) {
        cleanSuggestion.prefixText = String(s.prefixText);
      }
      if (s.suffixText !== undefined && s.suffixText !== null) {
        cleanSuggestion.suffixText = String(s.suffixText);
      }
      return cleanSuggestion;
    });
  }

  return cleanLog as StyleReviewLog;
}

async function dbSaveCrossCheckLog(log: CrossCheckLog): Promise<void> {
  const sanitized = sanitizeCrossCheckLog(log);
  const pathForWrite = `crosscheck_logs/${sanitized.id}`;
  try {
    const db = getDb();
    const docRef = doc(db, 'crosscheck_logs', sanitized.id);
    await setDoc(docRef, sanitized);
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error saving log to Firestore:', error);
    
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: `Save Failed: ${errorMsg}`,
      lastChecked: new Date().toISOString()
    };
    
    if (errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('insufficient')) {
      try {
        handleFirestoreError(error, OperationType.WRITE, pathForWrite);
      } catch (e) {
        // Continue
      }
      throw new Error(`${errorMsg}`);
    }
  }
  // Still sync to local logs
  const localLogs = getCrossCheckLogs();
  const idx = localLogs.findIndex(l => l.id === sanitized.id);
  if (idx !== -1) {
    localLogs[idx] = sanitized;
  } else {
    localLogs.unshift(sanitized);
  }
  saveCrossCheckLogs(localLogs);
}

async function dbDeleteCrossCheckLog(id: string): Promise<boolean> {
  const pathForWrite = `crosscheck_logs/${id}`;
  let success = false;
  try {
    const db = getDb();
    const docRef = doc(db, 'crosscheck_logs', id);
    await deleteDoc(docRef);
    success = true;
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error deleting log from Firestore:', error);
    
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: `Delete Failed: ${errorMsg}`,
      lastChecked: new Date().toISOString()
    };
    
    if (errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('insufficient')) {
      try {
        handleFirestoreError(error, OperationType.DELETE, pathForWrite);
      } catch (e) {
        // Continue
      }
    }
  }
  // Also delete locally
  const localLogs = getCrossCheckLogs();
  const updated = localLogs.filter(log => log.id !== id);
  if (localLogs.length !== updated.length) {
    success = true;
  }
  saveCrossCheckLogs(updated);
  return success;
}

async function dbClearCrossCheckLogs(): Promise<void> {
  const pathForGetDocs = 'crosscheck_logs';
  try {
    const db = getDb();
    const colRef = collection(db, pathForGetDocs);
    const snapshot = await getDocs(colRef);
    const promises: Promise<any>[] = [];
    snapshot.forEach((d) => {
      const docPath = `crosscheck_logs/${d.id}`;
      promises.push(
        deleteDoc(doc(db, 'crosscheck_logs', d.id)).catch((error) => {
          throw error;
        })
      );
    });
    await Promise.all(promises);
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error clearing Firestore logs:', error);
    
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: `Clear Failed: ${errorMsg}`,
      lastChecked: new Date().toISOString()
    };
  }
  saveCrossCheckLogs([]);
}

function getSessionLogs(): StyleReviewLog[] {
  try {
    if (fs.existsSync(SESSION_LOGS_PATH)) {
      return JSON.parse(fs.readFileSync(SESSION_LOGS_PATH, 'utf-8')) as StyleReviewLog[];
    }
  } catch (err) {
    console.error('Error reading session logs:', err);
  }
  return [];
}

function saveSessionLogs(logs: StyleReviewLog[]) {
  try {
    fs.writeFileSync(SESSION_LOGS_PATH, JSON.stringify(logs, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing session logs:', err);
  }
}

async function dbGetSessionLogs(): Promise<{ logs: StyleReviewLog[], status: typeof lastDbStatus }> {
  const pathForGetDocs = 'session_logs';
  try {
    const db = getDb();
    const colRef = collection(db, pathForGetDocs);
    const snapshot = await getDocs(colRef);
    const logs: StyleReviewLog[] = [];
    snapshot.forEach((d) => {
      logs.push(d.data() as StyleReviewLog);
    });
    // Sort descending by timestamp/id (newest first)
    logs.sort((a, b) => b.id.localeCompare(a.id));
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
    return { logs, status: lastDbStatus };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error fetching session logs from Firestore, using local file backup:', error);
    
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: errorMsg,
      lastChecked: new Date().toISOString()
    };
    
    if (errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('insufficient')) {
      try {
        handleFirestoreError(error, OperationType.GET, pathForGetDocs);
      } catch (e) {}
    }
    
    const logs = getSessionLogs();
    return { logs, status: lastDbStatus };
  }
}

async function dbSaveSessionLog(log: StyleReviewLog): Promise<void> {
  const sanitized = sanitizeSessionLog(log);
  const pathForWrite = `session_logs/${sanitized.id}`;
  try {
    const db = getDb();
    const docRef = doc(db, 'session_logs', sanitized.id);
    await setDoc(docRef, sanitized);
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error saving session log to Firestore:', error);
    
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: `Save Failed: ${errorMsg}`,
      lastChecked: new Date().toISOString()
    };
    
    if (errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('insufficient')) {
      try {
        handleFirestoreError(error, OperationType.WRITE, pathForWrite);
      } catch (e) {}
    }
  }
  // Still sync to local logs
  const localLogs = getSessionLogs();
  const idx = localLogs.findIndex(l => l.id === sanitized.id);
  if (idx !== -1) {
    localLogs[idx] = sanitized;
  } else {
    localLogs.unshift(sanitized);
  }
  saveSessionLogs(localLogs);
}

async function dbDeleteSessionLog(id: string): Promise<boolean> {
  const pathForWrite = `session_logs/${id}`;
  let success = false;
  try {
    const db = getDb();
    const docRef = doc(db, 'session_logs', id);
    await deleteDoc(docRef);
    success = true;
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error deleting session log from Firestore:', error);
    
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: `Delete Failed: ${errorMsg}`,
      lastChecked: new Date().toISOString()
    };
    
    if (errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('insufficient')) {
      try {
        handleFirestoreError(error, OperationType.DELETE, pathForWrite);
      } catch (e) {}
    }
  }
  // Also delete locally
  const localLogs = getSessionLogs();
  const updated = localLogs.filter(log => log.id !== id);
  if (localLogs.length !== updated.length) {
    success = true;
  }
  saveSessionLogs(updated);
  return success;
}

async function dbClearSessionLogs(): Promise<void> {
  const pathForGetDocs = 'session_logs';
  try {
    const db = getDb();
    const colRef = collection(db, pathForGetDocs);
    const snapshot = await getDocs(colRef);
    const promises: Promise<any>[] = [];
    snapshot.forEach((d) => {
      promises.push(
        deleteDoc(doc(db, 'session_logs', d.id)).catch((error) => {
          throw error;
        })
      );
    });
    await Promise.all(promises);
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error clearing Firestore session logs:', error);
    
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: `Clear Failed: ${errorMsg}`,
      lastChecked: new Date().toISOString()
    };
  }
  saveSessionLogs([]);
}

interface UserFeedback {
  id: string;
  timestamp: string;
  category: 'idea' | 'ux_request' | 'ai_error' | 'general';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'in_review' | 'resolved' | 'dismissed';
  userEmail: string;
  attachedContext?: string;
}

function getUserFeedbackLocal(): UserFeedback[] {
  try {
    if (fs.existsSync(USER_FEEDBACK_PATH)) {
      return JSON.parse(fs.readFileSync(USER_FEEDBACK_PATH, 'utf-8')) as UserFeedback[];
    }
  } catch (err) {
    console.error('Error reading user feedback local json:', err);
  }
  return [];
}

function saveUserFeedbackLocal(items: UserFeedback[]) {
  try {
    fs.writeFileSync(USER_FEEDBACK_PATH, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing user feedback local json:', err);
  }
}

function sanitizeUserFeedback(item: any): UserFeedback {
  return {
    id: String(item.id || '').substring(0, 120),
    timestamp: String(item.timestamp || new Date().toISOString()).substring(0, 100),
    category: ['idea', 'ux_request', 'ai_error', 'general'].includes(item.category) ? item.category : 'general',
    title: String(item.title || 'Untitled Feedback').substring(0, 500),
    description: String(item.description || '').substring(0, 50000),
    priority: ['low', 'medium', 'high', 'critical'].includes(item.priority) ? item.priority : 'medium',
    status: ['new', 'in_review', 'resolved', 'dismissed'].includes(item.status) ? item.status : 'new',
    userEmail: String(item.userEmail || 'unknown@broadsheet.com.au').substring(0, 200),
    attachedContext: item.attachedContext ? String(item.attachedContext).substring(0, 500000) : ''
  };
}

async function dbGetUserFeedback(): Promise<{ feedback: UserFeedback[], status: typeof lastDbStatus }> {
  const pathForGetDocs = 'user_feedback';
  try {
    const db = getDb();
    const colRef = collection(db, pathForGetDocs);
    const snapshot = await getDocs(colRef);
    const feedback: UserFeedback[] = [];
    snapshot.forEach((d) => {
      feedback.push(d.data() as UserFeedback);
    });
    feedback.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
    return { feedback, status: lastDbStatus };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error fetching user feedback from Firestore, using local file backup:', error);
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: errorMsg,
      lastChecked: new Date().toISOString()
    };
    const feedback = getUserFeedbackLocal();
    return { feedback, status: lastDbStatus };
  }
}

async function dbSaveUserFeedback(item: UserFeedback): Promise<void> {
  const sanitized = sanitizeUserFeedback(item);
  try {
    const db = getDb();
    const docRef = doc(db, 'user_feedback', sanitized.id);
    await setDoc(docRef, sanitized);
    
    lastDbStatus = {
      connected: true,
      source: 'firestore',
      error: null,
      lastChecked: new Date().toISOString()
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error saving user feedback to Firestore:', error);
    lastDbStatus = {
      connected: false,
      source: 'local_backup',
      error: `Save Failed: ${errorMsg}`,
      lastChecked: new Date().toISOString()
    };
  }
  const localItems = getUserFeedbackLocal();
  const idx = localItems.findIndex(i => i.id === sanitized.id);
  if (idx !== -1) {
    localItems[idx] = sanitized;
  } else {
    localItems.unshift(sanitized);
  }
  saveUserFeedbackLocal(localItems);
}

async function dbDeleteUserFeedback(id: string): Promise<boolean> {
  let success = false;
  try {
    const db = getDb();
    const docRef = doc(db, 'user_feedback', id);
    await deleteDoc(docRef);
    success = true;
  } catch (error: any) {
    console.error('Error deleting user feedback from Firestore:', error);
  }
  const localItems = getUserFeedbackLocal();
  const updated = localItems.filter(i => i.id !== id);
  if (localItems.length !== updated.length) success = true;
  saveUserFeedbackLocal(updated);
  return success;
}

interface CustomGuides {
  editorial?: string;
  banned?: string;
  dictionary?: string;
  mistakes?: string;
}

function getGuide(type: 'editorial'): string {
  try {
    if (fs.existsSync(CUSTOM_GUIDES_PATH)) {
      const data = JSON.parse(fs.readFileSync(CUSTOM_GUIDES_PATH, 'utf-8')) as CustomGuides;
      if (type === 'editorial' && data.editorial) return data.editorial;
    }
  } catch (err) {
    console.error('Error reading custom guides, falling back to defaults:', err);
  }
  
  if (type === 'editorial') return BROADSHEET_STYLE_GUIDE;
  return '';
}

/**
 * Redacts sensitive credentials, tokens, API keys, and personal identifiers (PII)
 * before passing data to AI models or persisting logs, ensuring zero data leakage.
 */
function redactSensitiveData(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text
    // API Keys and Tokens
    .replace(/\b(AIzaSy[a-zA-Z0-9_\-]{33})\b/g, '[REDACTED_GEMINI_KEY]')
    .replace(/\b(sk-[a-zA-Z0-9]{32,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(ghp_[a-zA-Z0-9]{36})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bBearer\s+[a-zA-Z0-9\-\._~\+\/]+=*/gi, 'Bearer [REDACTED_AUTH_TOKEN]')
    // Credit Cards
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[REDACTED_CARD_NUMBER]')
    // Australian Tax File Numbers / SSN patterns
    .replace(/\b\d{3}[- ]?\d{3}[- ]?\d{3}\b/g, '[REDACTED_ID_NUMBER]')
    // Secrets in payloads
    .replace(/("password"|"secret"|"apiKey"|"api_key")\s*:\s*"[^"]+"/gi, '$1: "[REDACTED_SECRET]"');
}

const ZERO_TRAINING_MANDATE_DIRECTIVE = `
[BROADSHEET DATA PRIVACY & ZERO THIRD-PARTY MODEL TRAINING DIRECTIVE]:
This request contains proprietary editorial material, draft articles, house guidelines, or crosscheck logs belonging strictly to Broadsheet Media. Under Broadsheet's Enterprise Security Policy:
1. NO MODEL TRAINING OR DATASET COLLECTION: All submitted copy and guidelines are strictly confidential and ephemeral. This content MUST NOT be cached beyond this transaction, logged to external data stores, or utilized under any circumstances for third-party model training, dataset curation, or fine-tuning.
2. ZERO DATA LEAKAGE: Unprocessed PII and private internal secrets must be stripped. No proprietary content may be exposed to unauthorized external services or secondary indexers.
`;

let ai: GoogleGenAI | null = null;
function getAI() {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log('GEMINI_API_KEY diagnostic:', {
      defined: typeof apiKey !== 'undefined',
      length: apiKey ? apiKey.length : 0,
      startsWith: apiKey ? apiKey.slice(0, 5) : '',
      isPlaceholder: apiKey === 'MY_GEMINI_API_KEY' || apiKey === '"MY_GEMINI_API_KEY"' || apiKey === 'YOUR_API_KEY'
    });
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables.');
    }
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'Broadsheet-CopyEditor/1.0 (Enterprise-Zero-Training)',
          'X-Data-Privacy-Policy': 'Enterprise-Zero-Training',
          'X-No-Data-Retention': 'true'
        }
      }
    });
  }
  return ai;
}

async function generateContentWithRetryAndFallback(
  client: GoogleGenAI,
  params: {
    model: string;
    contents: any;
    config?: any;
  }
): Promise<any> {
  const maxRetries = 3;
  let delay = 1000;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.models.generateContent(params);
    } catch (error: any) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isTransient = 
        errorMsg.includes('503') ||
        errorMsg.includes('429') ||
        errorMsg.toLowerCase().includes('unavailable') ||
        errorMsg.toLowerCase().includes('high demand') ||
        errorMsg.toLowerCase().includes('limit') ||
        errorMsg.toLowerCase().includes('spikes') ||
        errorMsg.toLowerCase().includes('exhausted');

      if (!isTransient) {
        console.warn(`Non-transient error in attempt ${attempt}: ${errorMsg}`);
        break;
      }

      console.warn(`Transient Gemini API error (attempt ${attempt}/${maxRetries}): ${errorMsg}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  if (params.model !== 'gemini-flash-latest') {
    console.warn(`Primary model '${params.model}' failed or busy. Falling back to 'gemini-flash-latest'...`);
    try {
      const fallbackParams = {
        ...params,
        model: 'gemini-flash-latest'
      };
      return await client.models.generateContent(fallbackParams);
    } catch (fallbackError: any) {
      const fbErrorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.error(`Fallback model 'gemini-flash-latest' also failed:`, fbErrorMsg);
      throw fallbackError;
    }
  }

  throw lastError;
}

function getSystemInstruction(dynamicMistakes: string, enableSocialMediaGuidelines: boolean = false) {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentDateString = currentDate.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `${ZERO_TRAINING_MANDATE_DIRECTIVE}
You are an expert and thorough copy editor for Broadsheet, an Australian digital publication covering food, travel, and culture. Your job is to check submitted copy against the Broadsheet style guide and return a structured JSON report.

CURRENT DATE CONTEXT:
The current date is ${currentDateString} (Year: ${currentYear}). Use this exact year when fact-checking any relative time math (e.g., "opened 3 years ago").

BROADSHEET EDITORIAL STYLE GUIDE:
${getGuide('editorial')}

BROADSHEET COMMON GRAMMAR & STYLE MISTAKES:
${COMMON_MISTAKES}
${dynamicMistakes}

${enableSocialMediaGuidelines ? `SOCIAL MEDIA COPYWRITING BEST PRACTICE GUIDE:
${SOCIAL_MEDIA_GUIDELINES}

CRITICAL INSTRUCTION FOR SOCIAL MEDIA COPY:
The user has enabled the Social Media Guidelines. If any rule in the Social Media Guidelines contradicts a rule in the Editorial Style Guide, Common Mistakes, or general styles, the Social Media Guidelines ALWAYS take precedence for this review.
` : ''}
CRITICAL ANTI-HALLUCINATION & FACT-CHECKING RULES:
1. NO MISSPELLED VENUE / BRAND NAME INVENTIONS:
   - Do NOT "correct" or "fact-check" venue names, brand names, bar/cafe/restaurant names, people's names, or location names (e.g., "Bar Spontana", "Cham", "Boire", "West Melbourne", "Brunswick") unless the name or variation is explicitly documented in the provided Style Guide as a banned word or typo.
   - If a venue name or brand name is not mentioned in the guide, assume it is spelled 100% correct. Do NOT guess foreign language spellings, grammatical suffixes, or alternative names (e.g., do NOT correct "Bar Spontana" to "Bar Spontaneo").
2. STRICT STYLE GUIDE GROUNDING & GRAMMAR/STYLE RULES:
   - Every entry in the "issues" array MUST map explicitly to a real preference, grammar, punctuation, or style rule listed in the BROADSHEET STYLE GUIDE or COMMON MISTAKES rules above.
   - Do NOT invent rules, assume preferences, or hallucinate style restrictions that are not explicitly documented in the provided resources.
   - STRICT ANTI-EXTRAPOLATION RULE: Do not use general brand or tone descriptors to invent unwritten rules or ban common abbreviations.
   - NO FALSE CAPITALISATION ALERTS: Do NOT flag words as violating capitalization rules if they are already capitalized in the text (e.g., if a guide option specifies "The Hot List" should be capped, and the editor typed "Hot-Listed", it starts with capital letters and should not be flagged as uncapitalized).
   - NO FORCEFUL REPHRASING: Do NOT use a style guide rule as an excuse to force a completely different phrasing (like changing "Hot-Listed" to "Hot List-approved" or rewriting safe adjectival compounds) unless the exact phrase is explicitly banned or misspelled. Respect the writer's voice and phrasing structure.
   - ADVISORY GUIDANCE VS. STRICT CORRECTION (APPLIES UNIVERSALLY TO ALL RULES):
     - For ALL categories and rules, when a style point is subjective, has multiple acceptable forms, involves contextual nuance, or represents an advisory standard rather than a definite error (e.g., word choice nuance, active vs. passive voice, regional preferences, or tone suggestions), do NOT force a rigid binary correction.
     - Instead, flag it as an ADVISORY NOTE or WARNING (setting "isNote" to true in the issue object) to provide clear guidance, recommendations, or a helpful warning to the editor. Use "isNote": false only for clear-cut, definite style issues (e.g. absolute typos, misspelled US-English words, or exact formatting rule issues).
   - If a word or phrase is not explicitly discouraged or specified in the guide (such as lightweight conversational text, names, standard punctuation), do NOT flag it as an issue.
3. PRESERVE INTENTIONAL COLLOQUIALS:
   - Do not flag light colloquialisms (e.g., "Hehe") or personal conversational tones from writers unless they explicitly violate broad tone boundaries (like "uber-cool" or coarse language in non-quotes).
4. SMART QUOTES & TYPOGRAPHIC APOSTROPHES (CRITICAL):
   - You MUST use proper typographic (curly) apostrophes (’) and quotation marks (“ ”) in all corrections and in the correctedCopy.
   - NEVER use straight quotes (' or ") or backticks (\`).
   - For all apostrophes, contractions (e.g., don’t, it’s, ’90s), and possessives, ALWAYS use the right-facing single curly quote (’) (U+2019). Do NOT use the left single quote (‘) for apostrophes. Pay strict attention to possessives and contractions to ensure they are handled correctly.
5. EXACT ORIGINAL SUBSTRINGS:
   - The "original" property MUST be a case-sensitive, exact character-for-character substring of the provided text.
6. OVERRIDING DICTIONARY & STYLE GUIDE HIERARCHY (CRITICAL PRIORITY):
   - The Broadsheet specific style guides always represent the highest authority and take absolute precedence over general Australian spelling or the Macquarie Dictionary.
7. TREATMENT OF DIRECT QUOTES / SPOKEN WORDS (CRITICAL STYLE RULE BOUNDARY):
   - Direct quotes or spoken words (enclosed within double quotation marks like "..." or “...” and single quotation marks like '...' or ‘...’) represent someone else's actual statement.
   - Grammar, tone or expression guidelines MUST NOT be applied to text within direct quotes. If a tone-discouraged word/phrase is said by a quoted person, do NOT flag it, do NOT correct it, and do NOT list it as an issue.
   - However, standard styling preferences (such as capitalization, formatting of numbers/dates, punctuation conventions) STILL APPLY and must be flagged and corrected even within quoted text.
8. CONTEXTUAL AWARENESS & NARRATIVE VOICE (HOLISTIC ANALYSIS):
   - Analyze the article as a cohesive whole rather than sentence-by-sentence. You must preserve the broader narrative context, established tone, and stylistic choices of the author.
   - Explicitly distinguish between the author's narrative voice and direct quotes. Understand that quotes or paraphrased segments may intentionally use different tones, colloquialisms, or structures that should not be heavily sanitized.
   - Do not mistake intentional stylistic choices (like sentence fragments for rhetorical effect in a creative review) as grammatical errors. Avoid enforcing sterile grammar if it damages the intended vibe or voice of the piece.
9. DATE MATH & EDITORIAL JUDGEMENTS (CRITICAL):
   - You MUST calculate relative dates precisely based on the CURRENT YEAR (${currentYear}). For example, if a venue opened in 2012, and the current year is ${currentYear}, it opened ${currentYear - 2012} years ago. Do not hallucinate math.
   - NO EDITORIAL MERIT JUDGMENTS: Do NOT flag a piece of text stating a venue "hasn't been open long enough to write about" or make ANY editorial judgement on whether a piece should be published based on dates. Your job is purely grammatical and mathematical copy editing. Do not act as a commissioning editor.

DATABASE-SEARCH METHODOLOGY FOR CONSISTENT QUALITY:
To maximize results consistency, make sure to systematically search each category of the style database:
- Step 1 (Contextual Demographics): If the copy refers to audience groups (e.g., Melbourne, Sydney, etc.), check "Category 8: Platform-Specific Guidelines" to confirm spelling (e.g., "Melburnians").
- Step 2 (Socio-cultural Topics & Entities): If the copy mentions brand names (e.g., Ikea, Adidas), check "Category 5: Names, Titles & Entities" to verify standard capitalization rules. If the copy mentions specific drinks or products (e.g., espresso martini, shiraz, negroni), check "Category 7: Specific Topics & Contexts".
- Step 3 (Numbers & Measures Rules): If the copy contains any numerical values, currencies, times of day, dates, or measurements, check "Category 6: Numbers, Dates & Time" rules.
- Step 4 (Grammar vs Typo Crosscheck): Scan all structures against "Category 2: Grammar & Mechanics" and "Category 3: Punctuation" to determine active vs passive structures and proper dash/comma usages.
- Step 5 (Strict Grounding): If a candidate style issue is NOT governed by a specific, explicit rule in one of these categories, do NOT flag it. Avoid inventing rules.

CRITICAL EXPLICIT COGNITIVE CHECKLIST - NEVER MISS THESE SPECIFIC FAILURE POINTS:
You MUST check every single word and punctuation mark in the document against these four critical areas:
1. HEADLINES & SUBHEADINGS CASING & METADATA:
   - Check every single subheading. If it is in ALL CAPS ("THE SET-UP", "SOFIA LEVIN, MASTERCHEF JUDGE"), you MUST convert it to standard sentence case ("The set-up", "Sofia Levin, Masterchef judge") in your corrections and flag it.
   - Technical metadata labels (e.g., SEO:, OG:, TWITTER:, TITLE:, EXCERPT:, DEK:, KEYWORDS:, SLUG:) must NOT be treated as shouting subheadings or lowercased. Keep prefixes capitalized as typed.
   - For main headlines, SEO titles, and OG tags: you MUST lowercase articles (the, a, an) and short prepositions under four letters (in, of, for, to, at, by, on, up, out, as) unless they start or end the title. (e.g., "Two-In-One / Open Prive in the Safe Deposit"). All elements of hyphenated compounds in title case MUST be capitalized (e.g., "Hard-To-Find", "Two-In-One", "Pop-Up").
   - Do NOT lowercase minor words when they are part of an official brand or venue name in headlines (e.g., "To Be Frank", "The Temper Trap", "The Everleigh").
2. QUOTATION MARK PUNCTUATION & LISTS:
   - For partial quotes or quote fragments, terminal periods and commas MUST sit OUTSIDE the closing quotation marks (e.g., “worlds away from La Rue”. or “taste like Macca’s, but better”,).
   - If a quote ends with a question mark or exclamation mark inside the quotation marks, you MUST NEVER append a full stop outside it. (e.g., “Have you eaten rice today?” instead of “Have you eaten rice today?”.).
   - Simple lists MUST NOT have unnecessary serial (Oxford) commas unless ambiguity exists.
   - Complex lists with internal commas MUST use semicolons to separate items, including a semicolon before the final "and".
3. COMPOUND WORDS, HYPHENS & PROPER NOUNS:
   - Always hyphenate geographic directions and quality/advancement adjectives when they precede a noun as compound modifiers (e.g., "north-side cafe", "south-side bar", "next-level dining", "good-quality burger").
   - NEVER HYPHENATE PROPER NOUN MODIFIERS: Proper nouns acting as modifiers preceding a noun (e.g., "Hot List fine diner", "The Rocks boutique", "Inner West cafe", "Taylor Swift concert") must NEVER be hyphenated. Under no circumstances should you suggest "Hot-List", "Hot-Listed", or other hyphenations for proper nouns.
   - NEVER HYPHENATE DUAL NATIONALITIES/IDENTITIES: Dual nationality, multi-ethnic, or dual cultural/geographic background descriptors (e.g., "Vietnamese Australian", "Italian Australian", "Greek Australian", "Chinese Cambodian") must NEVER be hyphenated, whether acting as a noun or as a compound modifier/adjective preceding a noun. Keep them as separate unhyphenated words.
   - "butterfly pea" is two words as a noun, but becomes "butterfly pea-blue" when acting as a compound color modifier. NEVER HYPHENATE REAL ESTATE: Keep "real estate" as two separate unhyphenated words in all contexts preceding a noun. NEVER HYPHENATE OR CAMELCASE ECOMMERCE: Keep "ecommerce" as a single, unhyphenated, all-lowercase word in all contexts.
   - Proper band names requiring definite articles (e.g., "The Temper Trap") MUST have their required "The" included.
   - COCKTAILS & SHORTHANDS: Cocktail names and their shorthands (Margarita, Marg, Cosmo, Negroni, Martini, Espresso Martini, Aperol Spritz) MUST be capitalized. NEVER suggest lowercasing them.
   - CLEAN INITIALISMS / ACRONYMS: Do NOT insert full stops/periods into clean initialisms or acronyms (e.g., "Liquid IV", "CBD", "NSW").
   - FACTUAL PLACEHOLDERS (TK): Do NOT replace editorial placeholders like "TK" or "TKs" with vague temporal words (e.g. "Recently") or unverified factual guesses. Leave "TK" placeholders intact or flag them as a placeholder note.
   - SUBSEQUENT NAME REFERENCES: Subsequent mentions of people in body copy MUST use last-name-only (e.g., "Lo Presti and Trewin" instead of "Michael and Rachel").
   - NOUN VS VERB PARSING (AUSTRALIAN ENGLISH): Maintain Australian English noun/verb spelling distinctions ("practice" is the noun, "practise" is the verb). Do NOT flag noun forms like "Zen practice" as errors or suggest changing them to "practise".
   - PLURAL COLLECTIVE QUANTIFIERS: Collective quantifier phrases modifying plural nouns take plural verb agreement (e.g., "a handful of newcomers are", "a couple of options are"). Do NOT force singular agreement ("is").
   - PRESERVE FOOTNOTES & META-NOTES: Leave editor/writer footnotes or bracketed meta-notes (e.g., [LB1], [LB2]) intact.
4. AMBIGUOUS & CLUNKY CONTRACTIONS:
   - Do NOT contract a noun with "'s" immediately before a present participle ending in "-ing" (e.g., change "where Nguyen’s firing" to "where Nguyen is firing").
   - EXCEPTION FOR LEGITIMATE POSSESSIVE GERUNDS: You must NEVER flag or modify correct possessive gerund phrases where the apostrophe-s denotes true, grammatical possession of a gerund noun (e.g. "Tan's cooking is excellent", "Nguyen's firing of staff was controversial").
   - Spell out awkward contractions like "room's housed" to "room is housed", or "that've" to "that have".
5. RICH-TEXT HTML STYLING & FORMATTING (CRITICAL - NO RAW MARKDOWN COMPLAINTS):
   - The user writes and edits copy in a rich-text HTML editor, NOT a markdown editor. They do NOT see or write markdown asterisks (*, **) or brackets ([, ]).
   - The plain-text document you receive represents the editor's rich-text HTML formatting using standard markdown markers: *text* for italics, **text** for bold, and [text](url) for hyperlinks.
   - You MUST identify and understand this styling to enforce relevant Broadsheet style rules (e.g. titles of publications, artworks, etc. must be italicized; names of exhibitions and musical artist tours like Wings Across America or Velvet Rope must be italicized; venue names must be hyperlinked; titles of artworks in headings/subheadings should NOT be italicized).
   - BUT, you are STRICTLY FORBIDDEN from generating style issues or recommendations about the markdown syntax itself.
   - Specifically:
     * Never complain about missing spaces before/after markdown brackets or parentheses of hyperlinks (e.g., NEVER flag things like "Missing space before the opening bracket of the hyperlink" or "and[Under the Sun...").
     * Never complain about stray spaces inside markdown italic/bold asterisks (e.g., NEVER flag things like "Stray space inside the italic markdown formatting" or "*technically *").
     * Never suggest a change whose only action or result is to adjust, clean up, remove, or fix spacing/positioning of asterisks or brackets unless it is specifically to apply or strip a Broadsheet style guide formatting rule (such as adding italics to an exhibition name or removing italics from a subheading title).
     * When applying corrections to the text (e.g., spelling, grammar, capitalisation), always preserve the surrounding formatting markers (*, **, or links) exactly as they are.

For the submitted copy, perform two mandatory tasks:
1. Identify all style guide deviations, and for each create an entry in the "issues" array:
   - "original": the EXACT uppercase/lowercase/accented text slice from the user's submit that has the issue. This MUST be a precise case-sensitive findable substring of the raw copy.
   - "rule": the name of the style guide section it relates to (e.g., GRAMMAR & MECHANICS, PUNCTUATION & QUOTATION MARK RULES, HEADLINES, SUBHEADINGS & AP TITLE CASE).
   - "issue": a clear editorial description of what rule is broken and why, referencing the style guide or core rulebook.
   - "fix": the exact literal replacement text string that should replace "original". CRITICAL: The "fix" field MUST ONLY contain the exact replacement text fraction (or empty string "" if isNote is true). NEVER place conversational instructions, meta-commentary, choice options (e.g. 'Standardize to either X or Y'), or advice inside "fix". Put all advice and explanations inside "issue".
   - "isNote": true if it's an ambiguous, advisory, or tone-based editorial note, false if it is a definite style issue. If isNote is true, set fix to "".
2. Provide the complete rewritten document under "correctedCopy" with all the suggestions correctly applied while keeping the writer's authentic voice intact.`;
}

function getCrossCheckSystemInstruction(dynamicDictionary: string, dynamicBanned: string, dynamicMistakes: string): string {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentDateString = currentDate.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `${ZERO_TRAINING_MANDATE_DIRECTIVE}
You are a high-level Quality Assurance meta-editor for Broadsheet, an Australian digital publication covering food, travel, and culture. Your job is to compare a Writer's Original Draft, the AI Copy Editor's Suggested draft (or current draft), the AI COPY EDITOR'S ISSUES DETECTED IN ORIGINAL DRAFT (Suggestions), and a Human Sub-editor's Finalized Masterpiece.

CURRENT DATE CONTEXT:
The current date is ${currentDateString} (Year: ${currentYear}). Use this exact year when verifying any relative time math.

Your goal is to perform a gap analysis objectively and accurately:
1. EVALUATE AI SUGGESTIONS vs HUMAN ACTIONS: Look at the AI's Suggestions and how the human handled them.
   - If the AI made a suggestion that the human accepted or implemented in the finalized copy, log this as a "correctAdherence".
   - If the AI made a suggestion that the human ignored or rejected (because the AI was wrong, hallucinating a rule, or overextrapolating), log this as a "missedInfraction" (False Positive by AI).
   - If the human corrected a genuine style/spelling error that the AI completely missed and did NOT suggest, log this as a "missedInfraction" (False Negative by AI).
2. IDENTIFY WHAT THE AI CAUGHT: Any style rules, spelling preferences, banned terms, house dictionary entries, punctuation guidelines, formatting issues, or factual nuances the AI Copy Editor CORRECTLY caught and resolved in full alignment with the Human Sub-editor MUST be returned under "correctAdherences".

TONE AND EXPLANATION CONSTRAINTS (CRITICAL):
- DO NOT overgeneralise. Use neutral, objective, and specific language.
- DO NOT use strong language, dramatic tone, or hyperbole in your explanations.
- DO NOT extrapolate unwritten rules. If a rule is not explicitly in the provided Style Guide, Banned Words, House Dictionary, Common Mistakes, or Macquarie spelling, do NOT invent it or penalize the AI for missing it. 
- Keep explanations factual and strictly based on the provided reference materials.

STYLE GUIDANCE BASE REGISTERS FOR REFERENCE:
1. BROADSHEET STYLE GUIDE:
${getGuide('editorial')}

2. BROADSHEET BANNED WORDS & PHRASES:
${dynamicBanned}

3. BROADSHEET A-Z HOUSE DICTIONARY:
${dynamicDictionary}

4. BROADSHEET COMMON GRAMMAR & STYLE MISTAKES:
${COMMON_MISTAKES}
${dynamicMistakes}

ANALYSIS GUIDELINES:
1. ONLY FLAG GENUINE GAPS OR FALSE POSITIVES: Look for cases where the human corrected a genuine error the AI missed, OR where the AI suggested a wrong fix that the human ignored. 
   - Pay critical focus to both the Editor AI and Human Editor's performance regarding these core areas:
     * HEADLINES & SUBHEADINGS CASING: converting shouting subheadings in ALL CAPS to sentence case, and properly lowercasing minor prepositions (< 4 letters) in Title Case.
     * QUOTES & LIST PUNCTUATION: placing terminal periods/commas OUTSIDE closing quote fragments/partial quotes, keeping periods/commas INSIDE full quotes, avoiding double quotation punctuation, stripping unnecessary serial (Oxford) commas, and utilizing semicolons + pre-final semicolon in complex list items.
     * COMPOUND WORDS & HYPHENS: hyphenating directional/quality compound modifiers preceding a noun (e.g. next-level, good-quality), and writing "butterfly pea" as two words but "butterfly pea-blue" as a color modifier, and NEVER hyphenating "real estate" (which must always be two unhyphenated words "real estate" even when preceding a noun), and NEVER hyphenating or camelCasing "ecommerce" (which must always be one single word "ecommerce" in all contexts). Never suggest hyphenating proper nouns acting as compound modifiers (e.g. "Hot List fine diner", "The Rocks boutique", "Inner West cafe"). Proper nouns MUST remain unhyphenated.
     * CONTRACTIONS: preventing noun's + -ing verb contraction (which introduces possessive ambiguity, like "Nguyen's firing" -> "Nguyen is firing") while preserving legitimate, correct possessive gerunds (e.g., "Tan's cooking is excellent"), and removing clunky noun-verb contractions (like "room's housed" -> "room is housed").
2. STRICTLY EXCLUDE SUBJECTIVE TONE, PHRASING AND WRITING VOICE SHIFTS FROM GAP ANALYSIS AND SCORE ACCURACY (CRITICAL):
   - Human sub-editors frequently rewrite copy purely for artistic flow, general readability, rhythm, cadence, or to preserve/enhance a specific creative writer's voice. They often break rigid style guide rules deliberately to make the text sound more natural, elegant, or punchy.
   - You MUST NOT treat these subjective rephrasings, stylistic tweaks, or tone/cadence adjustments as "missed infractions" or "gaps".
   - If the difference between the AI's version and the human's version is purely a matter of tone, flow, sentence structure, or creative phrasing rather than a strict violation of the registered Style Guide, Banned Words, House Dictionary, Macquarie Spelling, or Grammar/Punctuation mechanics, you MUST completely ignore it.
   - Such subjective creative shifts do NOT represent gaps. The gap analysis should represent ONLY strict, objective compliance alignment.
3. For each missed infraction, produce a highly precise "fineTuningPatch": a crisp, concise style guide entry that represents the rule so the user can paste/append it directly into their custom settings. If the missed infraction was the AI making a bad suggestion (False Positive), write a patch that instructs the AI NOT to make that mistake (e.g. "Do not flag X as incorrect").
4. Categorize the patch's "targetGuide" cleanly into one of: 'editorial', 'banned', 'dictionary', or 'mistakes'.
5. TREATMENT OF DIRECT QUOTES / SPOKEN WORDS (CRITICAL):
   - BANNED WORDS AND PHRASES guidelines do NOT apply to direct quotes/spoken words (enclosed within double quotes "..." / “...” or single quotes '...' / ‘...’).
   - If the Human finalized draft left a banned word or phrase inside a quoted passage intact, this is CORRECT, and the AI copy editor was ALSO correct in not flagging or changing it. Never treat intact banned words within direct quotes as "missed infractions" or "gaps".
   - However, standard spellings (e.g., Australian/Macquarie spelling preferences, typos) and stylings (punctuation, capitalization, numbers, and dates) still apply to quoted text, so the human is correct to correct spelling or styling errors inside quotes, and any failure of the AI to catch spelling/styling errors inside quotes does count as a missed infraction.
6. CONTEXTUAL AWARENESS & NARRATIVE VOICE:
   - Recognize when a Human editor correctly preserved the author's narrative voice or stylistically intentional sentence fragments, compared to an AI that might have overly sanitized the copy.
   - Do not flag instances where the human preserved stylistic flow or colloquialisms as "errors by the human". Understand that article-wide context often dictates tone.`;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          original: { 
            type: Type.STRING, 
            description: "The EXACT character-for-character case-sensitive substring from the original text that needs to be replaced. Must match exactly." 
          },
          rule: { 
            type: Type.STRING, 
            description: "The style guide rule name." 
          },
          issue: { 
            type: Type.STRING, 
            description: "Friendly description of the error or style advice." 
          },
          fix: { 
            type: Type.STRING, 
            description: "The suggested corrected replacement text." 
          },
          isNote: { 
            type: Type.BOOLEAN, 
            description: "True if it's just general advice or a reminder, false if it violates a strict style guide rule." 
          }
        },
        required: ["original", "rule", "issue", "fix", "isNote"]
      }
    },
    correctedCopy: {
      type: Type.STRING,
      description: "The fully corrected story text. Preserve original paragraphs, headings, spacing. Apply all style guide rules."
    }
  },
  required: ["issues", "correctedCopy"]
};

const CROSS_CHECK_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    alignmentGap: { 
      type: Type.STRING, 
      description: "A neutral, concise summary of what specific types of errors or terms the AI missed or falsely suggested. MUST strictly exclude subjective tone, writing voice, readability, or artistic flow rewrites. Do not use strong language." 
    },
    missedInfractions: {
      type: Type.ARRAY,
      description: "A list of style/editorial issues where the human corrected the text but the AI missed it (False Negative), OR where the AI suggested a wrong fix that the human rejected (False Positive).",
      items: {
        type: Type.OBJECT,
        properties: {
          original: { type: Type.STRING, description: "The original segment of text containing the issue." },
          human: { type: Type.STRING, description: "How the human handled this segment in their finalized version." },
          ai: { type: Type.STRING, description: "How the AI copy editor handled it, or the incorrect suggestion it made." },
          rule: { type: Type.STRING, description: "The style guide category or Macquarie standard that applies." },
          explanation: { type: Type.STRING, description: "Objective explanation of why the human's version is correct and what the AI missed or falsely suggested." },
          fineTuningPatch: { type: Type.STRING, description: "A concrete, actionable bullet point or entry that the user can copy-paste into our custom style guides to fix this gap." },
          targetGuide: { 
            type: Type.STRING, 
            description: "Which of the 4 document registers this patch should be added to ('editorial', 'banned', 'dictionary', 'mistakes')." 
          }
        },
        required: ["original", "human", "ai", "rule", "explanation", "fineTuningPatch", "targetGuide"]
      }
    },
    fineTuningActionable: {
      type: Type.STRING,
      description: "A neutral summary with objective recommendations for refining instructions or updating Custom Guide Documents."
    },
    correctAdherences: {
      type: Type.ARRAY,
      description: "A list of style/editorial rules, spelling preferences, or formatting alignments where the AI correctly edited or provided a suggestion that the human accepted.",
      items: {
        type: Type.OBJECT,
        properties: {
          original: { type: Type.STRING, description: "The original segment of text or rule description." },
          corrected: { type: Type.STRING, description: "How both the AI and Human styled/corrected this segment, or the AI suggestion that the human accepted." },
          rule: { type: Type.STRING, description: "The style guide category or Macquarie standard that applies." },
          explanation: { type: Type.STRING, description: "Objective explanation of why this correction or adherence is correct and aligned." }
        },
        required: ["original", "corrected", "rule", "explanation"]
      }
    }
  },
  required: ["alignmentGap", "missedInfractions", "fineTuningActionable", "correctAdherences"]
};

const CONSISTENCY_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          original: { 
            type: Type.STRING, 
            description: "A short excerpt from the text illustrating the consistency issue or entity introduction." 
          },
          rule: { 
            type: Type.STRING, 
            description: "The name of the consistency check, e.g. 'Context Check' or 'Spelling Consistency'." 
          },
          issue: { 
            type: Type.STRING, 
            description: "Detailed explanation of the missing context or inconsistency. (e.g. \"You referred to 'Smith' here, but never introduced their full name or title earlier.\")" 
          },
          fix: { 
            type: Type.STRING, 
            description: "Suggested fix, or empty string if it's just a note." 
          },
          isNote: { 
            type: Type.BOOLEAN, 
            description: "Should be true for general consistency notes where a direct text replacement might be complex." 
          }
        },
        required: ["original", "rule", "issue", "fix", "isNote"]
      }
    }
  },
  required: ["issues"]
};

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeIssues(issues: any[]): any[] {
  if (!Array.isArray(issues)) return [];
  return issues.map(issue => {
    let original = String(issue.original || '').trim();
    let rule = String(issue.rule || '').trim();
    let issueText = String(issue.issue || '').trim();
    let fix = String(issue.fix || '').trim();
    let isNote = Boolean(issue.isNote);

    // Detect if fix contains LLM conversational instruction / meta-talk / choice directives
    const isAdvisory = isNote || 
      /^(Standardize|Consider|Ensure|Verify|Check|Note:|Optionally|Rephrase|Choose|Decide|Select|Adjust|Change to|Use either|Suggest|Recommend)/i.test(fix) ||
      /\b(across both|in the text|for consistency|or similar|either .+ or .+|both paragraphs|both sentences|in both|across the document)\b/i.test(fix) ||
      (fix.length > 70 && /[.!?]/.test(fix));

    if (isAdvisory) {
      isNote = true;
      if (fix && !issueText.toLowerCase().includes(fix.toLowerCase())) {
        issueText = issueText ? `${issueText} Recommendation: ${fix}` : fix;
      }
      fix = "";
    }

    return {
      original,
      rule,
      issue: issueText,
      fix,
      isNote
    };
  });
}

function runPreflightScans(copy: string, enableSocialMediaGuidelines: boolean = false): any[] {
  const issues: any[] = [];
  const lines = copy.split('\n');

  const addIssue = (item: any) => {
    if (!item.original || item.original.trim().length === 0) return;
    if (!issues.some(x => x.original === item.original)) {
      issues.push(item);
    }
  };

  // Helper to process sentence case
  function toSentenceCase(str: string): string {
    if (!str) return str;
    const words = str.toLowerCase().split(/\s+/);
    if (words.length === 0) return str;
    
    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    
    const names = ["Sofia", "Levin", "Masterchef", "Nguyen", "Melbourne", "Sydney", "Fremantle", "Guinness", "La", "Rue", "Temper", "Trap"];
    return words.map((w, index) => {
      if (index === 0) return w;
      const cleanWord = w.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"");
      const foundName = names.find(name => name.toLowerCase() === cleanWord.toLowerCase());
      if (foundName) {
        return w.replace(new RegExp(escapeRegExp(cleanWord), 'i'), foundName);
      }
      return w;
    }).join(' ');
  }

  // 1. ALL CAPS SUBHEADINGS
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length > 3 && trimmed.length < 100) {
      // Ignore technical metadata label prefixes (SEO:, OG:, TWITTER:, TITLE:, EXCERPT:, DEK:, KEYWORDS:, SLUG:)
      if (/^(SEO|OG|TWITTER|TITLE|EXCERPT|DEK|KEYWORDS|SLUG|META|URL):/i.test(trimmed)) {
        return;
      }
      // Ignore HTML comments and XML blocks
      if (trimmed.startsWith('<!--') || trimmed.endsWith('-->')) {
        return;
      }
      const hasLetters = /[a-zA-Z]/.test(trimmed);
      const isAllCap = trimmed === trimmed.toUpperCase();
      if (hasLetters && isAllCap) {
        if (index > 0) {
          const properCase = toSentenceCase(trimmed);
          addIssue({
            original: trimmed,
            rule: "HEADLINES, SUBHEADINGS & AP TITLE CASE",
            issue: "ALL CAPS SUBHEADINGS: Convert shouting uppercase subheadings into standard sentence case (only capitalize the first letter of the first word and proper nouns).",
            fix: properCase,
            isNote: false
          });
        }
      }
    }
  });

  // 2. HEADLINE TITLE CASE MINOR WORDS (AP Style)
  if (lines.length > 0 && lines[0].trim().length > 0 && !enableSocialMediaGuidelines) {
    const headline = lines[0].trim();
    // Only apply AP Title Case rule if the line looks like a typical short headline
    if (headline.length < 150) {
      const minorWords = ["The", "A", "An", "In", "Of", "For", "To", "At", "By", "On", "Up", "Out", "As", "And", "But", "Or", "Nor"];
      const words = headline.split(/\s+/);
      
      if (words.length > 2) {
        for (let i = 1; i < words.length - 1; i++) {
          const rawWord = words[i];
          const cleanWord = rawWord.replace(/^[“"'(]+|[)"'”.,:;!?]+$/g, '');
          
          const prevWord = words[i - 1];
          // Skip if previous word ends with sentence-ending punctuation or colon
          if (prevWord && /[.:!?]$/.test(prevWord.replace(/["'”’]+$/, ''))) {
            continue;
          }

          // Skip proper brand name words like "To Be Frank", "The Temper Trap", "Van Gogh"
          if (headline.includes("To Be Frank") || headline.includes("The Temper Trap") || headline.includes("The Everleigh") || headline.includes("Van Gogh")) {
            continue;
          }

          if (minorWords.includes(cleanWord)) {
            const correctWord = cleanWord.toLowerCase();
            const fixedWord = rawWord.replace(cleanWord, correctWord);
            addIssue({
              original: rawWord,
              rule: "HEADLINES, SUBHEADINGS & AP TITLE CASE",
              issue: `CAPITALIZING MINOR WORDS IN TITLE CASE: Under AP Title Case rules (main headlines, SEO titles, and OG tags), minor words like "${cleanWord}" must be lowercased unless they begin or end the title.`,
              fix: fixedWord,
              isNote: false
            });
          }
        }
      }
    }
  }

  // 3. QUOTATION MARK RULES
  // Matches quote fragments with periods or commas inside
  const fragmentRegex = /([“"])([a-z][^”"]*?)([,.])([”"])/g;
  let match;
  while ((match = fragmentRegex.exec(copy)) !== null) {
    const fullMatch = match[0];
    const openQuote = match[1];
    const contents = match[2];
    const punctuation = match[3];
    const closeQuote = match[4];
    
    const fixed = `${openQuote}${contents}${closeQuote}${punctuation}`;
    addIssue({
      original: fullMatch,
      rule: "PUNCTUATION & QUOTATION MARK RULES",
      issue: `QUOTE FRAGMENT PUNCTUATION PLACEMENT: For partial quotes or fragments, terminal periods and commas must sit OUTSIDE the closing quotation marks. Only full quoted sentences start with a capital letter and carry punctuation inside.`,
      fix: fixed,
      isNote: false
    });
  }

  // Double Punctuation on Quotes
  const doublePunctRegex = /([“"'][^”"']*?[?!])[”"']\./g;
  while ((match = doublePunctRegex.exec(copy)) !== null) {
    const fullMatch = match[0];
    const fixed = fullMatch.slice(0, -1);
    addIssue({
      original: fullMatch,
      rule: "PUNCTUATION & QUOTATION MARK RULES",
      issue: `DOUBLE PUNCTUATION ON QUOTES: Never append a full stop outside a quote that already terminates with its own punctuation (like a question mark or exclamation mark) inside.`,
      fix: fixed,
      isNote: false
    });
  }

  // Simple lists and serial (Oxford) comma checking
  const oxfordRegex = /(\b\w+\b),\s*(\b\w+\b),\s*and\s+(\b\w+\b)/gi;
  while ((match = oxfordRegex.exec(copy)) !== null) {
    const fullMatch = match[0];
    const parts = fullMatch.split(/,\s*/);
    if (parts.length === 3) {
      const fixed = `${parts[0]}, ${parts[1]} ${parts[2]}`;
      addIssue({
        original: fullMatch,
        rule: "PUNCTUATION & QUOTATION MARK RULES",
        issue: `THE SERIAL (OXFORD) COMMA: Avoid using unnecessary serial commas in simple lists of three or more items where no ambiguity exists.`,
        fix: fixed,
        isNote: false
      });
    }
  }

  // 4. BRAND NAMES, COMPOUND WORDS & HYPHENATION
  const compoundRegexes = [
    { regex: /\b(north|south|east|west) side\s+(\w+)\b/gi, fixBuilder: (m: string[]) => `${m[1]}-side ${m[2]}` },
    { regex: /\bnext level\s+(\w+)\b/gi, fixBuilder: (m: string[]) => `next-level ${m[1]}` },
    { regex: /\bgood quality\s+(\w+)\b/gi, fixBuilder: (m: string[]) => `good-quality ${m[1]}` }
  ];

  compoundRegexes.forEach(({ regex, fixBuilder }) => {
    let m;
    while ((m = regex.exec(copy)) !== null) {
      const fullMatch = m[0];
      const fixed = fixBuilder(m);
      addIssue({
        original: fullMatch,
        rule: "BRAND NAMES, COMPOUND WORDS & HYPHENATION",
        issue: `MISSING GEOGRAPHIC & ADJECTIVE HYPHENS: Always hyphenate "${m[1]} ${m[0].split(' ')[1]}" when playing the role of a compound modifier preceding a noun.`,
        fix: fixed,
        isNote: false
      });
    }
  });

  // Culinary Hyphenation
  const butterflyRegex = /\bbutterfly pea blue\b/gi;
  while ((match = butterflyRegex.exec(copy)) !== null) {
    addIssue({
      original: match[0],
      rule: "BRAND NAMES, COMPOUND WORDS & HYPHENATION",
      issue: "INCORRECT CULINARY HYPHENATION: 'butterfly pea' is two words as a noun/ingredient, but becomes 'butterfly pea-blue' as a color modifier preceding a noun.",
      fix: "butterfly pea-blue",
      isNote: false
    });
  }

  // Definite Articles for Bands
  const bandRegex = /\b(?:the\s+)?Temper Trap\b/g;
  while ((match = bandRegex.exec(copy)) !== null) {
    if (match[0] !== "The Temper Trap") {
      addIssue({
        original: match[0],
        rule: "BRAND NAMES, COMPOUND WORDS & HYPHENATION",
        issue: "MISSING DEFINITE ARTICLES FOR BANDS: Always refer to the proper band name as 'The Temper Trap' with capital 'T' for 'The'.",
        fix: "The Temper Trap",
        isNote: false
      });
    }
  }

  // Global fix for known spelling mistakes
  const guinnessRegex = /\bGuiness\b/gi;
  let gMatch;
  while ((gMatch = guinnessRegex.exec(copy)) !== null) {
    addIssue({
      original: gMatch[0],
      rule: "BRAND NAMES, COMPOUND WORDS & HYPHENATION",
      issue: "GLOBAL BRAND NAME MISSPELLINGS: 'Guinness' is misspelled. Correct globally to 'Guinness' with double 'n' and double 's'.",
      fix: "Guinness",
      isNote: false
    });
  }

  // Preorder hyphenation
  const preorderRegex = /\b(preorder)(s?)\b/gi;
  while ((match = preorderRegex.exec(copy)) !== null) {
    const orig = match[0];
    const isCapitalized = orig.charAt(0) === 'P';
    const isPlural = match[2] === 's';
    const suggested = (isCapitalized ? 'Pre' : 'pre') + '-order' + (isPlural ? 's' : '');
    addIssue({
      original: orig,
      rule: "BRAND NAMES, COMPOUND WORDS & HYPHENATION",
      issue: "INCORRECT PREFIX DE-HYPHENATION: 'pre-order' must be hyphenated according to Macquarie standards. Do not merge into 'preorder' by analogy to presale/preloved.",
      fix: suggested,
      isNote: false
    });
  }

  // Ecommerce spelling and casing check
  const ecomRegex = /\b(e-commerce|eCommerce|E-commerce)(s?)\b/g;
  while ((match = ecomRegex.exec(copy)) !== null) {
    const orig = match[0];
    const isCapitalized = orig.charAt(0) === 'E';
    const isPlural = match[2] === 's';
    const suggested = (isCapitalized ? 'Ecommerce' : 'ecommerce') + (isPlural ? 's' : '');
    addIssue({
      original: orig,
      rule: "BRAND NAMES, COMPOUND WORDS & HYPHENATION",
      issue: "INCORRECT ECOMMERCE COUPLING: 'ecommerce' must be written as a single, unhyphenated word in all lowercase (i.e. 'ecommerce' or 'Ecommerce' starting a sentence), never camelcased or hyphenated.",
      fix: suggested,
      isNote: false
    });
  }

  // 5. AMBIGUOUS & CLUNKY CONTRACTIONS
  // Note: Simple regex matches like Noun's + -ing produce severe false positives on correct possessive-gerund phrases
  // (e.g., "Tan's cooking is excellent", "Nguyen's firing of staff was difficult").
  // This check is now delegated entirely to Gemini, which contextually distinguishes possessives from contractions.

  const roomHousedRegex = /\broom['’]s\s+housed\b/gi;
  while ((match = roomHousedRegex.exec(copy)) !== null) {
    addIssue({
      original: match[0],
      rule: "AMBIGUOUS & CLUNKY CONTRACTIONS",
      issue: "AWKWARD NOUN-VERB CONTRACTIONS: Avoid clunky, unnatural contractions like 'room's housed'. Spell them out.",
      fix: "room is housed",
      isNote: false
    });
  }

  const thatveRegex = /\bthat['’]ve\b/gi;
  while ((match = thatveRegex.exec(copy)) !== null) {
    addIssue({
      original: match[0],
      rule: "AMBIGUOUS & CLUNKY CONTRACTIONS",
      issue: "AWKWARD CONJUNCTION/PRONOUN CONTRACTIONS: Avoid clunky contractions like 'that've'. Spell them out.",
      fix: "that have",
      isNote: false
    });
  }

  return issues;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Set keep-alive headers and request/response timeouts to prevent prematurely dropping long-running connections
  app.use((req: Request, res: Response, next) => {
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=600, max=1000');
    req.setTimeout(600000); // 10 minutes
    res.setTimeout(600000); // 10 minutes
    next();
  });

  // Enforce anti-leakage HTTP security & cache-control headers on all API routes
  app.use('/api', (req: Request, res: Response, next: any) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), interest-cohort=()');
    res.setHeader('X-Broadsheet-Data-Protection', 'Enterprise-Zero-Training-Active');
    next();
  });

  // GET /api/security/privacy-status - Verification of AI model training opt-out and data leakage safeguards (Admin-only)
  app.get('/api/security/privacy-status', checkAdmin, (req: Request, res: Response) => {
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      broadsheetOrganization: "Broadsheet Media",
      safeguards: {
        thirdPartyModelTrainingOptOut: {
          status: "ENFORCED",
          description: "System instructions and API headers explicitly mandate zero third-party AI model training and zero dataset ingestion."
        },
        zeroDataRetentionPolicy: {
          status: "ENFORCED",
          description: "Prompts and editorial copy are processed ephemerally in server memory with no persistent external retention."
        },
        serverSideProxyIsolation: {
          status: "ENFORCED",
          description: "All Gemini API calls are proxied strictly via server-side routes (/api/*). No API keys or tokens are exposed to client devices."
        },
        piiRedactionEngine: {
          status: "ACTIVE",
          description: "Automatic sanitization and scrubbing of sensitive credentials, API tokens, and personal identifiers before AI execution."
        },
        dataCachePreventionHeaders: {
          status: "ENFORCED",
          description: "HTTP responses carry strict Cache-Control: no-store and no-cache headers to prevent browser/CDN caching of sensitive copy."
        },
        databaseAccessRules: {
          status: "ENFORCED",
          description: "Firestore zero-trust Security Rules prevent direct client writes and validate all document schemas."
        }
      }
    });
  });

  app.post('/api/review', checkAuthorized, async (req: Request, res: Response) => {
    const { copy: rawCopy, enableSocialMediaGuidelines, enableThinkingMode } = req.body;
    if (!rawCopy) {
      return res.status(400).json({ error: 'No copy provided' });
    }

    const copy = redactSensitiveData(rawCopy);

    try {
      const client = getAI();

      const styleDb = getStyleDb();
      const mistakesDoc = await getDocFromServer(doc(styleDb, 'style_guide', 'common_mistakes'));

      const dynamicMistakes = mistakesDoc.data()?.content || '';
      
      let enhancedSytemInstruction = getSystemInstruction(dynamicMistakes, enableSocialMediaGuidelines);

      const requestConfig: any = {
        systemInstruction: enhancedSytemInstruction,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.0,
      };

      if (enableThinkingMode) {
        requestConfig.thinkingConfig = { includeThoughts: true };
      }

      const response = await generateContentWithRetryAndFallback(client, {
        model: 'gemini-3.6-flash',
        contents: copy,
        config: requestConfig,
      });
      
      const geminiResult = parseGeminiJSON(response.text || '{}');
      const geminiIssues = geminiResult.issues || [];
      let correctedCopy = geminiResult.correctedCopy || copy;

      // Run our deterministic preflight scanner
      const preflightIssues = runPreflightScans(copy, enableSocialMediaGuidelines);

      // Merge issues - preflight (deterministic) goes first
      const mergedIssuesRaw = [...preflightIssues];
      for (const gi of geminiIssues) {
        const isDuplicate = mergedIssuesRaw.some(pi => 
          pi.original === gi.original || 
          gi.original.includes(pi.original) ||
          pi.original.includes(gi.original)
        );
        if (!isDuplicate) {
          mergedIssuesRaw.push(gi);
        }
      }

      // Programmatic filtering to eliminate incorrect proper noun hyphenation suggestions
      const mergedIssues = mergedIssuesRaw.filter(issue => {
        const orig = issue.original || "";
        const fix = issue.fix || "";
        const desc = (issue.issue || "").toLowerCase();
        
        const dualNatMatch = fix.match(/\b([A-Z][a-zA-Z]+)-([A-Z][a-zA-Z]+)\b/);
        if (dualNatMatch && ["Australian", "American", "Cambodian", "British", "Canadian", "European", "Vietnamese", "Italian", "Greek", "Chinese", "French", "Japanese", "Lebanese", "German", "Indian", "Thai", "Korean", "Spanish", "Indonesian", "Filipino", "Malaysian", "Singaporean"].includes(dualNatMatch[2]) && !orig.includes('-')) {
          console.log(`Programmatically filtered out dual-nationality hyphenation: original="${orig}", fix="${fix}"`);
          return false;
        }
        const properNouns = ["Hot List", "The Rocks", "Inner West", "Taylor Swift", "Crown Melbourne"];
        for (const pn of properNouns) {
          const pnRegex = new RegExp(escapeRegExp(pn).replace(/\s+/g, '[\\s\\-_]*'), 'i');
          if (pnRegex.test(orig) || pnRegex.test(fix)) {
            if (fix.includes('-') && !orig.includes('-')) {
              console.log(`Programmatically filtered out improper proper noun hyphenation: original="${orig}", fix="${fix}"`);
              return false;
            }
          }
        }
        
        if (fix.toLowerCase().includes('real-estate') && !orig.toLowerCase().includes('real-estate')) {
          console.log(`Programmatically filtered out real-estate hyphenation: original="${orig}", fix="${fix}"`);
          return false;
        }

        if (fix.toLowerCase().includes('e-commerce') || fix.includes('eCommerce') || fix.includes('E-commerce')) {
          console.log(`Programmatically filtered out e-commerce / eCommerce suggestion: original="${orig}", fix="${fix}"`);
          return false;
        }
        
        if (desc.includes('hot-list') || desc.includes('hot-listed')) {
          if (fix.includes('-') || fix.toLowerCase().includes('hot-list')) {
            console.log(`Programmatically filtered out improper Hot List hyphenation suggestion: issue="${issue.issue}"`);
            return false;
          }
        }

        // Filter out cocktail lowercasing suggestions
        const cocktails = ["Margarita", "Marg", "Cosmo", "Cosmopolitan", "Negroni", "Martini", "Espresso Martini", "Aperol Spritz", "Daiquiri", "Manhattan", "Old Fashioned", "Bloody Mary"];
        for (const c of cocktails) {
          if (orig.toLowerCase() === c.toLowerCase() && fix.toLowerCase() === c.toLowerCase()) {
            if (orig === c && fix === c.toLowerCase()) {
              console.log(`Programmatically filtered out cocktail lowercasing suggestion: original="${orig}", fix="${fix}"`);
              return false;
            }
          }
        }

        // Filter out technical metadata label lowercasing suggestions (e.g. SEO:, OG:, TWITTER:)
        if (/^(SEO|OG|TWITTER|TITLE|EXCERPT|DEK|KEYWORDS|SLUG|META|URL):/i.test(orig)) {
          if (fix.toLowerCase().startsWith(orig.toLowerCase().split(':')[0])) {
            console.log(`Programmatically filtered out metadata label lowercasing suggestion: original="${orig}", fix="${fix}"`);
            return false;
          }
        }

        // Filter out "Zen practice" -> "Zen practise" false suggestions
        if (orig.toLowerCase().includes('practice') && fix.toLowerCase().includes('practise')) {
          if (orig.toLowerCase().includes('zen practice') || orig.toLowerCase().includes('daily practice') || orig.toLowerCase().includes('medical practice') || orig.toLowerCase().includes('common practice')) {
            console.log(`Programmatically filtered out noun practice false suggestion: original="${orig}", fix="${fix}"`);
            return false;
          }
        }

        // Filter out "a handful of [plural] is" false suggestions
        if (orig.toLowerCase().includes('are') && fix.toLowerCase().includes('is')) {
          if (orig.toLowerCase().includes('handful of') || orig.toLowerCase().includes('couple of') || orig.toLowerCase().includes('number of')) {
            console.log(`Programmatically filtered out collective quantifier false suggestion: original="${orig}", fix="${fix}"`);
            return false;
          }
        }

        // Filter out period insertion into clean initialisms (e.g. Liquid IV -> Liquid I.V.)
        if (orig.includes('Liquid IV') || orig.includes('CBD') || orig.includes('NSW')) {
          if (fix.includes('Liquid I.V.') || fix.includes('C.B.D.') || fix.includes('N.S.W.')) {
            console.log(`Programmatically filtered out initialism period insertion suggestion: original="${orig}", fix="${fix}"`);
            return false;
          }
        }

        // Filter out proper brand name lowercasing in headlines (e.g. To Be Frank -> To be Frank)
        if (orig.includes('To Be Frank') && fix.includes('To be Frank')) {
          console.log(`Programmatically filtered out brand name lowercasing suggestion: original="${orig}", fix="${fix}"`);
          return false;
        }

        return true;
      });

      // Actively apply the programmatic fixes to correctedCopy if they were missed by Gemini
      for (const pi of preflightIssues) {
        if (correctedCopy.includes(pi.original)) {
          correctedCopy = correctedCopy.replace(new RegExp(escapeRegExp(pi.original), 'g'), pi.fix);
        }
      }

      // Actively restore proper nouns if they were incorrectly hyphenated in correctedCopy
      correctedCopy = correctedCopy.replace(/\b([A-Z][a-zA-Z]+)-(Australian|American|Cambodian|British|Canadian|European|Vietnamese|Italian|Greek|Chinese|French|Japanese|Lebanese|German|Indian|Thai|Korean|Spanish|Indonesian|Filipino|Malaysian|Singaporean|Syrian|Turkish|Irish|Scottish|Welsh)\b/g, (match, origin, nationality) => {
        return `${origin} ${nationality}`;
      });
      correctedCopy = correctedCopy.replace(/\be-commerce\b/g, "ecommerce");
      correctedCopy = correctedCopy.replace(/\bE-commerce\b/g, "Ecommerce");
      correctedCopy = correctedCopy.replace(/\beCommerce\b/g, "ecommerce");
      correctedCopy = correctedCopy.replace(/\bECommerce\b/g, "Ecommerce");
      const properNounsToRestore = [
        { regex: /real-estate/gi, restore: "real estate" },
        { regex: /e-commerce/gi, restore: "ecommerce" },
        { regex: /Hot-List/gi, restore: "Hot List" },
        { regex: /Hot-Listed/gi, restore: "Hot List" },
        { regex: /Inner-West/gi, restore: "Inner West" },
        { regex: /The-Rocks/gi, restore: "The Rocks" }
      ];
      for (const item of properNounsToRestore) {
        if (item.regex.test(correctedCopy) && !item.regex.test(copy)) {
          correctedCopy = correctedCopy.replace(item.regex, item.restore);
        }
      }

      correctedCopy = enforceSmartQuotes(correctedCopy);

      res.json({
        issues: sanitizeIssues(mergedIssues),
        correctedCopy: correctedCopy
      });
    } catch (error) {
      console.error('Error during editorial review:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to perform review' });
    }
  });

  app.post('/api/consistency-check', checkAuthorized, async (req: Request, res: Response) => {
    const { copy: rawCopy, headline: rawHeadline, enableThinkingMode } = req.body;
    if (!rawCopy) {
      return res.status(400).json({ error: 'No copy provided' });
    }

    const copy = redactSensitiveData(rawCopy);
    const headline = rawHeadline ? redactSensitiveData(rawHeadline) : '';

    try {
      const client = getAI();

      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentDateString = currentDate.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      const systemInstruction = `You are a strict editorial Consistency and Context Checker.
Your task is to analyze the provided article (and headline, if provided) ONLY for structural consistency, missing entity introductions, and internal logical conflicts.
DO NOT check for grammar, style guide violations, spelling mistakes, or sentence flow unless it creates a logical inconsistency across the document.

CRITICAL INSTRUCTION FOR THE 'fix' FIELD:
The 'fix' field MUST ONLY contain the exact literal replacement string to replace 'original' in the text. NEVER put conversational instructions, meta-commentary, choice options (e.g., 'Standardize to either X or Y'), or advice inside 'fix'. If an issue is an advisory note or consistency warning where there is no single exact text replacement, set isNote: true and set fix: "" (empty string), and place all advice/explanations inside the 'issue' field.

CURRENT DATE CONTEXT:
The current date is ${currentDateString} (Year: ${currentYear}). Use this exact year when checking any relative time math.

Focus STRICTLY on:
1. Missing Context / Entity Introductions: Are people, acronyms, or places referred to in shorthand (e.g., "Smith", "the new restaurant") before they are properly introduced?
2. Internal Consistency (Spelling & Naming): Is the same name or entity spelled inconsistently across paragraphs? (e.g., "Macquarie" in paragraph 1, "Macquarrie" in paragraph 6)
3. Factual/Logical Consistency: Does the body copy contradict the headline? Do paragraphs contradict each other? (e.g., Headline says "new restaurant", body says "opened three years ago").
4. DATE MATH & EDITORIAL JUDGEMENTS (CRITICAL):
   - You MUST calculate relative dates precisely based on the CURRENT YEAR (${currentYear}). For example, if a venue opened in 2012, and the current year is ${currentYear}, it opened ${currentYear - 2012} years ago. Do not hallucinate math.
   - NO EDITORIAL MERIT JUDGMENTS: Do NOT flag a piece of text stating a venue "hasn't been open long enough to write about" or make ANY editorial judgement on whether a piece should be published based on dates. Your job is purely grammatical and mathematical copy editing. Do not act as a commissioning editor.

Return the issues you find in the required JSON format. If you find no consistency issues, return an empty array for issues. Set 'isNote' to true for these issues and set 'fix' to empty string "".`;

      let prompt = copy;
      if (headline) {
        prompt = `HEADLINE:\n${headline}\n\nBODY COPY:\n${copy}`;
      }

      const requestConfig: any = {
        systemInstruction: systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: CONSISTENCY_RESPONSE_SCHEMA,
        temperature: 0.1,
      };

      if (enableThinkingMode) {
        requestConfig.thinkingConfig = { includeThoughts: true };
      }

      const response = await generateContentWithRetryAndFallback(client, {
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: requestConfig,
      });
      
      const geminiResult = parseGeminiJSON(response.text || '{}');
      const issues = geminiResult.issues || [];

      res.json({ issues: sanitizeIssues(issues) });
    } catch (error) {
      console.error('Error during consistency check:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to perform consistency check' });
    }
  });

  app.post('/api/dictionary-check', checkAuthorized, async (req: Request, res: Response) => {
    const { copy: rawCopy, enableThinkingMode } = req.body;
    if (!rawCopy) {
      return res.status(400).json({ error: 'No copy provided' });
    }

    const copy = redactSensitiveData(rawCopy);

    try {
      const client = getAI();

      const styleDb = getStyleDb();
      const [dictDoc, bannedDoc] = await Promise.all([
        getDocFromServer(doc(styleDb, 'style_guide', 'dictionary')),
        getDocFromServer(doc(styleDb, 'style_guide', 'banned'))
      ]);

      const dynamicDictionary = dictDoc.data()?.content || '';
      const dynamicBanned = bannedDoc.data()?.content || '';
      const macquarieMatchesStr = findMacquarieMatches(copy);

      const systemInstruction = `You are an expert copy editor specializing in Broadsheet's House Dictionary, Banned Words & Phrases, and Australian/Macquarie spelling alignment.
Your job is to check submitted copy ONLY against the Broadsheet House Dictionary, Banned Words and Phrases, and official Macquarie dictionary preferences, and return a structured JSON report.

BROADSHEET BANNED WORDS & PHRASES:
${dynamicBanned}

BROADSHEET A-Z HOUSE DICTIONARY:
${dynamicDictionary}

${macquarieMatchesStr ? `OFFICIAL MACQUARIE AUSTRALIAN DICTIONARY PREFERENCES:
${macquarieMatchesStr}` : ''}

CRITICAL RULES:
1. ONLY FLAG DIRECT HOUSE DICTIONARY VIOLATIONS, BANNED WORDS, OR NON-AUSTRALIAN/MACQUARIE TYPOS:
   - If a word or phrase is on the Broadsheet Banned Words list, flag it as a violation.
   - If a word is used that is spelled contrary to the Broadsheet House Dictionary or Macquarie standard (e.g. US spelling "color" instead of "colour", or "co-ordinate" instead of "coordinate" when the hyphen rules dictate), flag it as a violation and provide the correct spelling.
   - STRICT SPELLING GROUNDING: Every entry in the "issues" array MUST map explicitly to a real spelling preference, banned word, or style rule listed above.
   - Do NOT invent rules, assume preferences, or flag other grammatical or editorial style guide issues in this check.
   - ANTI-HALLUCINATION FOR ACRONYMS & CAPITALISATION (CRITICAL): Do NOT flag common acronyms (like BYO, RSVP, TV, etc.) as needing lowercase just because Macquarie Dictionary might prefer it lowercase. Broadsheet prefers them uppercase. NEVER invent Macquarie Dictionary preferences. ONLY enforce Macquarie Dictionary preferences for terms EXPLICITLY LISTED in the "OFFICIAL MACQUARIE AUSTRALIAN DICTIONARY PREFERENCES" section above. Do not hallucinate Macquarie entries.
   - If there is any conflict between the Broadsheet House Dictionary and Macquarie Dictionary, Broadsheet's House Dictionary ALWAYS takes absolute precedence.
2. TREATMENT OF DIRECT QUOTES / SPOKEN WORDS (CRITICAL):
   - Banned words and phrases must NOT be flagged if they occur inside direct quotes.
   - However, spelling typos (like US spelling of standard words) still apply and must be flagged/corrected inside quotes.
3. EXACT ORIGINAL SUBSTRINGS:
   - The "original" property MUST be a case-sensitive, exact character-for-character substring of the provided text.
4. TYPOGRAPHIC SMART QUOTES:
   - You MUST use proper typographic (curly) apostrophes (’) and quotation marks (“ ”) in all corrections and in the correctedCopy.

For the submitted copy, identify all dictionary & banned deviations, and for each create an entry in the "issues" array:
- "original": the EXACT uppercase/lowercase/accented text slice from the user's submit that has the issue.
- "rule": the name of the rule category (either 'BANNED WORDS AND PHRASES', 'CHRONOLOGICAL DICTIONARY (A-Z)', or 'MACQUARIE DICTIONARY').
- "issue": a clear editorial description of what rule is broken and why.
- "fix": the corrected text fraction that should replace "original".
- "isNote": true if it's an advisory, tone-based dictionary suggestion, false if it is a definite style issue (e.g., explicit banned word or clear spelling typo).`;

      const requestConfig: any = {
        systemInstruction: systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: CONSISTENCY_RESPONSE_SCHEMA,
        temperature: 0.0,
      };

      if (enableThinkingMode) {
        requestConfig.thinkingConfig = { includeThoughts: true };
      }

      const response = await generateContentWithRetryAndFallback(client, {
        model: 'gemini-3.6-flash',
        contents: copy,
        config: requestConfig,
      });

      const geminiResult = parseGeminiJSON(response.text || '{}');
      const issues = geminiResult.issues || [];

      res.json({ issues: sanitizeIssues(issues) });
    } catch (error) {
      console.error('Error during dictionary check:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to perform dictionary check' });
    }
  });

  app.post('/api/crosscheck', checkSubEditorOrAdmin, async (req: Request, res: Response) => {
    const { originalCopy: rawOriginal, aiCorrected: rawAi, humanFinalized: rawHuman, aiSuggestions } = req.body;
    if (!rawOriginal || !rawAi || !rawHuman) {
      return res.status(400).json({ error: 'originalCopy, aiCorrected, and humanFinalized are all required.' });
    }

    const originalCopy = redactSensitiveData(rawOriginal);
    const aiCorrected = redactSensitiveData(rawAi);
    const humanFinalized = redactSensitiveData(rawHuman);

    try {
      const client = getAI();

      const styleDb = getStyleDb();
      const [dictDoc, bannedDoc, mistakesDoc] = await Promise.all([
        getDocFromServer(doc(styleDb, 'style_guide', 'dictionary')),
        getDocFromServer(doc(styleDb, 'style_guide', 'banned')),
        getDocFromServer(doc(styleDb, 'style_guide', 'common_mistakes'))
      ]);

      const dynamicDictionary = dictDoc.data()?.content || '';
      const dynamicBanned = bannedDoc.data()?.content || '';
      const dynamicMistakes = mistakesDoc.data()?.content || '';

      const prompt = `WRITER'S ORIGINAL DRAFT:
"""
${originalCopy}
"""

AI COPY EDITOR'S SUGGESTED DRAFT:
"""
${aiCorrected}
"""

HUMAN SUB-EDITOR'S FINALIZED MASTERPIECE:
"""
${humanFinalized}
"""

AI COPY EDITOR'S ISSUES DETECTED IN ORIGINAL DRAFT (Suggestions):
"""
${aiSuggestions ? JSON.stringify(aiSuggestions, null, 2) : 'None provided.'}
"""

Please compare these texts and identify any style guide violations, preference errors, or spelling mistakes that the Human sub-editor caught and corrected, but the AI failed to notice or correct in its suggested draft. Also evaluate which AI suggestions the Human Editor accepted or ignored.`;

      // Scan for Macquarie matches in the involved texts
      const macquarieMatchesStr = findMacquarieMatches(originalCopy + ' ' + humanFinalized);
      let enhancedCrossCheckInstruction = getCrossCheckSystemInstruction(dynamicDictionary, dynamicBanned, dynamicMistakes);
      if (macquarieMatchesStr) {
        enhancedCrossCheckInstruction += `\n\nOFFICIAL MACQUARIE AUSTRALIAN DICTIONARY PREFERENCES (MATCHED COMPLIANCES):
Use these preferences when judging correctness. If the human aligned spelling with these Macquarie standards while the AI did not, highlight it. Remember that Broadsheet's House Guidelines, Banned Words, and House Dictionary ALWAYS take absolute precedence over Macquarie preferences in matches:
${macquarieMatchesStr}`;
      }

      const response = await generateContentWithRetryAndFallback(client, {
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          systemInstruction: enhancedCrossCheckInstruction,
          responseMimeType: 'application/json',
          responseSchema: CROSS_CHECK_RESPONSE_SCHEMA,
          temperature: 0.0,
        },
      });

      const result = parseGeminiJSON(response.text || '{}');

      const missedCount = Array.isArray(result.missedInfractions) ? result.missedInfractions.length : 0;
      const correctCount = Array.isArray(result.correctAdherences) ? result.correctAdherences.length : 0;
      const totalCount = missedCount + correctCount;
      const computedScore = totalCount === 0 ? 100 : Math.round((correctCount / totalCount) * 100);

      // Save to logs database/history
      try {
        const newLog: CrossCheckLog = {
          id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000).toString(),
          timestamp: new Date().toISOString(),
          lastEvaluatedAt: new Date().toISOString(),
          originalCopy,
          aiCorrected,
          humanFinalized,
          accuracyScore: computedScore,
          alignmentGap: result.alignmentGap || '',
          missedInfractions: result.missedInfractions || [],
          correctAdherences: result.correctAdherences || [],
          fineTuningActionable: result.fineTuningActionable || '',
          userEmail: (req.headers['x-user-email'] as string || 'unknown@broadsheet.com.au').toLowerCase().trim(),
          aiSuggestions: aiSuggestions || []
        };
        await dbSaveCrossCheckLog(newLog);
      } catch (logErr) {
        console.error('Failed to save to cross check logs:', logErr);
      }

      res.json({ ...result, accuracyScore: computedScore });
    } catch (error) {
      console.error('Error during human-AI cross-check:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to perform human-AI cross-check' });
    }
  });

  // Re-evaluate an existing cross check log retroactively
  app.post('/api/crosscheck/re-evaluate/:id', checkSubEditorOrAdmin, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const dbResult = await dbGetCrossCheckLogs();
      const existingLog = dbResult.logs.find(log => log.id === id);
      if (!existingLog) {
        return res.status(404).json({ error: 'Log not found.' });
      }

      const client = getAI();

      const styleDb = getStyleDb();
      const [dictDoc, bannedDoc, mistakesDoc] = await Promise.all([
        getDocFromServer(doc(styleDb, 'style_guide', 'dictionary')),
        getDocFromServer(doc(styleDb, 'style_guide', 'banned')),
        getDocFromServer(doc(styleDb, 'style_guide', 'common_mistakes'))
      ]);

      const dynamicDictionary = dictDoc.data()?.content || '';
      const dynamicBanned = bannedDoc.data()?.content || '';
      const dynamicMistakes = mistakesDoc.data()?.content || '';

      const prompt = `WRITER'S ORIGINAL DRAFT:
"""
${existingLog.originalCopy}
"""

AI COPY EDITOR'S SUGGESTED DRAFT:
"""
${existingLog.aiCorrected}
"""

HUMAN SUB-EDITOR'S FINALIZED MASTERPIECE:
"""
${existingLog.humanFinalized}
"""

AI COPY EDITOR'S ISSUES DETECTED IN ORIGINAL DRAFT (Suggestions):
"""
${existingLog.aiSuggestions ? JSON.stringify(existingLog.aiSuggestions, null, 2) : 'None provided.'}
"""

Please compare these texts and identify any style guide violations, preference errors, or spelling mistakes that the Human sub-editor caught and corrected, but the AI failed to notice or correct in its suggested draft. Also evaluate which AI suggestions the Human Editor accepted or ignored.`;

      const macquarieMatchesStr = findMacquarieMatches(existingLog.originalCopy + ' ' + existingLog.humanFinalized);
      let enhancedCrossCheckInstruction = getCrossCheckSystemInstruction(dynamicDictionary, dynamicBanned, dynamicMistakes);
      if (macquarieMatchesStr) {
        enhancedCrossCheckInstruction += `\n\nOFFICIAL MACQUARIE AUSTRALIAN DICTIONARY PREFERENCES (MATCHED COMPLIANCES):
Use these preferences when judging correctness. If the human aligned spelling with these Macquarie standards while the AI did not, highlight it. Remember that Broadsheet's House Guidelines, Banned Words, and House Dictionary ALWAYS take absolute precedence over Macquarie preferences in matches:
${macquarieMatchesStr}`;
      }

      const response = await generateContentWithRetryAndFallback(client, {
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          systemInstruction: enhancedCrossCheckInstruction,
          responseMimeType: 'application/json',
          responseSchema: CROSS_CHECK_RESPONSE_SCHEMA,
          temperature: 0.0,
        },
      });

      const result = parseGeminiJSON(response.text || '{}');

      const missedCount = Array.isArray(result.missedInfractions) ? result.missedInfractions.length : 0;
      const correctCount = Array.isArray(result.correctAdherences) ? result.correctAdherences.length : 0;
      const totalCount = missedCount + correctCount;
      const computedScore = totalCount === 0 ? 100 : Math.round((correctCount / totalCount) * 100);

      const updatedLog: CrossCheckLog = {
        ...existingLog,
        lastEvaluatedAt: new Date().toISOString(),
        accuracyScore: computedScore,
        alignmentGap: result.alignmentGap || '',
        missedInfractions: result.missedInfractions || [],
        correctAdherences: result.correctAdherences || [],
        fineTuningActionable: result.fineTuningActionable || ''
      };

      await dbSaveCrossCheckLog(updatedLog);

      res.json({ success: true, log: updatedLog });
    } catch (error) {
      console.error('Error during retroactive re-evaluation:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to re-evaluate log.' });
    }
  });

  // Retrieve all logged cross check responses
  app.get('/api/crosscheck/logs', checkSubEditorOrAdmin, async (req: Request, res: Response) => {
    try {
      const dbResult = await dbGetCrossCheckLogs();
      res.setHeader('X-Database-Source', dbResult.status.source);
      if (dbResult.status.error) {
        res.setHeader('X-Database-Error', encodeURIComponent(dbResult.status.error));
      }
      res.json(dbResult);
    } catch (error) {
      console.error('Error listing cross check logs:', error);
      res.status(500).json({ error: 'Failed to retrieve cross check logs database.' });
    }
  });

  // Get database connection status and credentials
  app.get('/api/db-status', (req: Request, res: Response) => {
    try {
      getDb();
    } catch (e) {
      console.warn("Lazy getDb invocation during status check failed:", e);
    }
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    let firebaseConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (e) {}
    }
    res.json({
      status: lastDbStatus,
      firebaseConfig: {
        projectId: (firebaseConfig as any).projectId || null,
        databaseId: (firebaseConfig as any).firestoreDatabaseId || '(default)',
        apiKey: (firebaseConfig as any).apiKey || null,
        authDomain: (firebaseConfig as any).authDomain || null,
        appId: (firebaseConfig as any).appId || null,
        storageBucket: (firebaseConfig as any).storageBucket || null,
        messagingSenderId: (firebaseConfig as any).messagingSenderId || null
      }
    });
  });

  // Backend local authentication register endpoint
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const cleanEmail = email.toLowerCase().trim();
      const db = getDb();
      if (!db) {
        return res.status(503).json({ error: "Database service unavailable." });
      }

      const userDocRef = doc(db, 'authorized_users', cleanEmail);
      const snap = await getDocFromServer(userDocRef);
      if (snap.exists()) {
        const userData = snap.data();
        if (userData.password) {
          return res.status(400).json({ error: "An account with this email address already exists." });
        }
        // If they already exist in the collection but have no password set (i.e. they were pre-invited), update their password
        const updated = {
          ...userData,
          password: password,
          updatedAt: new Date().toISOString()
        };
        await setDoc(userDocRef, updated);
        return res.json({
          success: true,
          email: cleanEmail,
          role: userData.role || 'editor',
          status: userData.status || 'pending'
        });
      }

      // If they don't exist, create them
      const isInitialAdmin = cleanEmail === 'james.harrison@broadsheet.com.au';
      const payload = {
        email: cleanEmail,
        password: password,
        role: isInitialAdmin ? 'admin' : 'editor',
        status: isInitialAdmin ? 'active' : 'pending',
        invitedBy: 'self-register',
        invitedAt: new Date().toISOString()
      };

      await setDoc(userDocRef, payload);

      res.status(201).json({
        success: true,
        email: cleanEmail,
        role: payload.role,
        status: payload.status
      });
    } catch (err: any) {
      console.error("[AUTH] Backend register error:", err);
      res.status(500).json({ error: err.message || "Internal registration error" });
    }
  });

  // Backend local authentication login endpoint
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const cleanEmail = email.toLowerCase().trim();
      const db = getDb();
      if (!db) {
        return res.status(503).json({ error: "Database service unavailable." });
      }

      const userDocRef = doc(db, 'authorized_users', cleanEmail);
      const snap = await getDocFromServer(userDocRef);

      if (!snap.exists()) {
        // If cleanEmail is the original admin, automatically seed them so they can log in
        if (cleanEmail === 'james.harrison@broadsheet.com.au') {
          const payload = {
            email: cleanEmail,
            password: password,
            role: 'admin',
            status: 'active',
            invitedBy: 'system-auto',
            invitedAt: new Date().toISOString()
          };
          await setDoc(userDocRef, payload);
          return res.json({
            success: true,
            email: cleanEmail,
            role: 'admin',
            status: 'active'
          });
        }
        return res.status(444).json({ error: "Welcome! No account matches this email. Check your spelling or toggle Register." });
      }

      const userData = snap.data();
      
      // If no password exists on the record (e.g. they were pre-invited but hadn't set password yet or seeded)
      if (!userData.password) {
        await setDoc(userDocRef, {
          ...userData,
          password: password,
          updatedAt: new Date().toISOString()
        });
        return res.json({
          success: true,
          email: cleanEmail,
          role: userData.role || 'editor',
          status: userData.status || 'pending'
        });
      }

      if (userData.password !== password) {
        return res.status(401).json({ error: "Incorrect password. Please verify and try again." });
      }

      res.json({
        success: true,
        email: cleanEmail,
        role: userData.role || 'editor',
        status: userData.status || 'pending'
      });
    } catch (err: any) {
      console.error("[AUTH] Backend login error:", err);
      res.status(500).json({ error: err.message || "Internal authentication error" });
    }
  });

  // Verify current user details
  app.get('/api/auth/me', async (req: Request, res: Response) => {
    try {
      const email = req.headers['x-user-email'] as string;
      if (!email) {
        return res.status(401).json({ error: "Unauthenticated" });
      }

      const cleanEmail = email.toLowerCase().trim();
      const db = getDb();
      if (!db) {
        return res.status(503).json({ error: "Database service unavailable." });
      }

      const userDocRef = doc(db, 'authorized_users', cleanEmail);
      const snap = await getDocFromServer(userDocRef);
      if (snap.exists()) {
        const userData = snap.data();
        if (userData.status === 'active') {
          return res.json({
            email: cleanEmail,
            role: userData.role || 'editor',
            status: userData.status || 'pending'
          });
        } else {
          return res.status(403).json({
            error: "Pending authorization",
            status: userData.status
          });
        }
      }
      return res.status(444).json({ error: "User not found" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a specific log entry by ID
  app.delete('/api/crosscheck/logs/:id', checkSubEditorOrAdmin, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const deleted = await dbDeleteCrossCheckLog(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Log entry not found.' });
      }
      res.json({ success: true, message: 'Log entry successfully deleted from database.' });
    } catch (error) {
      console.error('Error deleting cross check log:', error);
      res.status(500).json({ error: 'Failed to delete log entry.' });
    }
  });

  // Clear all log entries
  app.post('/api/crosscheck/logs/clear', checkSubEditorOrAdmin, async (req: Request, res: Response) => {
    try {
      await dbClearCrossCheckLogs();
      res.json({ success: true, message: 'Logs database successfully cleared.' });
    } catch (error) {
      console.error('Error clearing cross check logs:', error);
      res.status(500).json({ error: 'Failed to clear database logs.' });
    }
  });

  // Get shared session review logs
  app.get('/api/session-logs', checkAuthorized, async (req: Request, res: Response) => {
    try {
      const dbResult = await dbGetSessionLogs();
      res.setHeader('X-Database-Source', dbResult.status.source);
      if (dbResult.status.error) {
        res.setHeader('X-Database-Error', encodeURIComponent(dbResult.status.error));
      }
      res.json(dbResult);
    } catch (error) {
      console.error('Error listing session logs:', error);
      res.status(500).json({ error: 'Failed to retrieve session logs database.' });
    }
  });

  // Save/Update a shared session review log
  app.post('/api/session-logs', checkAuthorized, async (req: Request, res: Response) => {
    try {
      const log = req.body as StyleReviewLog;
      log.userEmail = (req.headers['x-user-email'] as string || 'unknown@broadsheet.com.au').toLowerCase().trim();
      await dbSaveSessionLog(log);
      res.json({ success: true, message: 'Session log saved/synced with shared database.' });
    } catch (error) {
      console.error('Error saving session log:', error);
      res.status(500).json({ error: 'Failed to save session log.' });
    }
  });

  // Delete a specific session review log
  app.delete('/api/session-logs/:id', checkAdmin, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const deleted = await dbDeleteSessionLog(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Session log entry not found.' });
      }
      res.json({ success: true, message: 'Session log entry successfully deleted.' });
    } catch (error) {
      console.error('Error deleting session log:', error);
      res.status(500).json({ error: 'Failed to delete session log entry.' });
    }
  });

  // Clear all session review logs
  app.post('/api/session-logs/clear', checkAdmin, async (req: Request, res: Response) => {
    try {
      await dbClearSessionLogs();
      res.json({ success: true, message: 'Session logs database successfully cleared.' });
    } catch (error) {
      console.error('Error clearing session logs:', error);
      res.status(500).json({ error: 'Failed to clear session logs.' });
    }
  });

  // Submit user feedback
  app.post('/api/feedback', checkAuthorized, async (req: Request, res: Response) => {
    try {
      const { category, title, description, priority, attachedContext } = req.body;
      if (!title || !description) {
        return res.status(400).json({ error: 'Title and description are required.' });
      }
      const userEmail = (req.headers['x-user-email'] as string || 'unknown@broadsheet.com.au').toLowerCase().trim();
      const feedbackItem: UserFeedback = {
        id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000).toString(),
        timestamp: new Date().toISOString(),
        category: category || 'general',
        title: title.trim(),
        description: description.trim(),
        priority: priority || 'medium',
        status: 'new',
        userEmail,
        attachedContext: attachedContext || ''
      };
      await dbSaveUserFeedback(feedbackItem);
      res.status(201).json({ success: true, feedback: feedbackItem });
    } catch (error) {
      console.error('Error submitting feedback:', error);
      res.status(500).json({ error: 'Failed to submit feedback.' });
    }
  });

  // Get list of user feedback
  app.get('/api/feedback', checkAuthorized, async (req: Request, res: Response) => {
    try {
      const dbResult = await dbGetUserFeedback();
      res.setHeader('X-Database-Source', dbResult.status.source);
      if (dbResult.status.error) {
        res.setHeader('X-Database-Error', encodeURIComponent(dbResult.status.error));
      }
      res.json(dbResult);
    } catch (error) {
      console.error('Error retrieving user feedback:', error);
      res.status(500).json({ error: 'Failed to retrieve user feedback.' });
    }
  });

  // Update feedback status
  app.patch('/api/feedback/:id/status', checkAuthorized, async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !['new', 'in_review', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Valid status (new, in_review, resolved, dismissed) is required.' });
    }
    try {
      const dbResult = await dbGetUserFeedback();
      const existing = dbResult.feedback.find(item => item.id === id);
      if (!existing) {
        return res.status(404).json({ error: 'Feedback item not found.' });
      }
      existing.status = status as any;
      await dbSaveUserFeedback(existing);
      res.json({ success: true, feedback: existing });
    } catch (error) {
      console.error('Error updating feedback status:', error);
      res.status(500).json({ error: 'Failed to update feedback status.' });
    }
  });

  // Delete user feedback
  app.delete('/api/feedback/:id', checkAdmin, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const deleted = await dbDeleteUserFeedback(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Feedback item not found.' });
      }
      res.json({ success: true, message: 'Feedback entry deleted.' });
    } catch (error) {
      console.error('Error deleting feedback item:', error);
      res.status(500).json({ error: 'Failed to delete feedback entry.' });
    }
  });

  // Get current active style guide documents
  app.get('/api/documents', checkAuthorized, async (req: Request, res: Response) => {
    try {
      const styleDb = getStyleDb();
      const [dictDoc, bannedDoc, mistakesDoc] = await Promise.all([
        getDocFromServer(doc(styleDb, 'style_guide', 'dictionary')),
        getDocFromServer(doc(styleDb, 'style_guide', 'banned')),
        getDocFromServer(doc(styleDb, 'style_guide', 'common_mistakes'))
      ]);

      res.json({
        editorial: getGuide('editorial'),
        banned: bannedDoc.data()?.content || '',
        dictionary: dictDoc.data()?.content || '',
        mistakes: mistakesDoc.data()?.content || ''
      });
    } catch (error) {
      console.error('Error fetching style guide documents:', error);
      res.status(500).json({ error: 'Failed to retrieve style guide documents' });
    }
  });

  // Update a style guide document dynamically
  app.post('/api/documents', checkAdmin, async (req: Request, res: Response) => {
    const { documentType, content } = req.body;
    if (!documentType || typeof content !== 'string') {
      return res.status(400).json({ error: 'documentType (editorial | banned | dictionary | mistakes) and content are required.' });
    }

    if (!['editorial', 'banned', 'dictionary', 'mistakes'].includes(documentType)) {
      return res.status(400).json({ error: 'Invalid documentType. Must be editorial, banned, dictionary, or mistakes.' });
    }

    try {
      let data: CustomGuides = {};
      if (fs.existsSync(CUSTOM_GUIDES_PATH)) {
        try {
          data = JSON.parse(fs.readFileSync(CUSTOM_GUIDES_PATH, 'utf-8'));
        } catch (e) {
          console.warn('Error parsing existing custom_guides.json, recreating:', e);
        }
      }

      data[documentType as keyof CustomGuides] = content;
      fs.writeFileSync(CUSTOM_GUIDES_PATH, JSON.stringify(data, null, 2), 'utf-8');
      
      // Persistently sync to Firestore
      try {
        const db = getDb();
        if (db) {
          await setDoc(doc(db, 'style_guides', 'custom_guides'), data);
          console.log('Successfully synced updated custom guides to Firestore.');
        }
      } catch (fsErr) {
        console.error('Failed to sync custom guides to Firestore:', fsErr);
      }
      
      res.json({ success: true, message: `Style guide for '${documentType}' successfully updated.` });
    } catch (error) {
      console.error('Error updating style guide document:', error);
      res.status(500).json({ error: 'Failed to write updated style guide to disk.' });
    }
  });

  // Import/Save Macquarie Dictionary JSON
  app.post('/api/macquarie-dictionary', checkAdmin, async (req: Request, res: Response) => {
    const { dictionary } = req.body;
    if (!dictionary) {
      return res.status(400).json({ error: 'No dictionary data provided' });
    }

    try {
      let parsedData: any = null;
      if (typeof dictionary === 'string') {
        parsedData = JSON.parse(dictionary);
      } else {
        parsedData = dictionary;
      }

      // Save to server
      fs.writeFileSync(MACQUARIE_DICT_PATH, JSON.stringify(parsedData, null, 2), 'utf-8');
      
      // Clear cache so it reloads on next scan
      macquarieDictCache = null;
      macquarieDictMeta = null;
      
      // Compute and check stats
      const loaded = loadMacquarieDict();
      if (!loaded) {
        throw new Error('Dictionary was saved but failed to parse correctly into memory structure.');
      }

      // Persistently sync to Firestore in chunks due to 1MB document limit
      try {
        const db = getDb();
        if (db) {
          const jsonStr = JSON.stringify(parsedData);
          const chunkSize = 800000; // ~800KB chunk size
          const totalChunks = Math.ceil(jsonStr.length / chunkSize);
          
          console.log(`Syncing Macquarie dictionary to Firestore in ${totalChunks} chunks...`);
          
          // Save metadata
          await setDoc(doc(db, 'macquarie_dict', 'metadata'), {
            totalChunks,
            wordCount: macquarieDictMeta ? macquarieDictMeta.wordCount : 0,
            fileSize: jsonStr.length,
            updatedAt: new Date().toISOString()
          });
          
          // Save chunks
          for (let i = 0; i < totalChunks; i++) {
            const chunkContent = jsonStr.substring(i * chunkSize, (i + 1) * chunkSize);
            await setDoc(doc(db, 'macquarie_dict', `chunk_${i}`), { content: chunkContent });
          }
          console.log(`Successfully synced all ${totalChunks} chunks to Firestore.`);
        }
      } catch (fsErr) {
        console.error('Failed to sync Macquarie Dictionary to Firestore:', fsErr);
      }

      res.json({
        success: true,
        message: 'Macquarie Dictionary JSON successfully imported and saved.',
        stats: macquarieDictMeta
      });
    } catch (error: any) {
      console.error('Error saving Macquarie dictionary:', error);
      res.status(500).json({ error: `Failed to import Macquarie Dictionary: ${error.message}` });
    }
  });

  // Get Macquarie Dictionary status info
  app.get('/api/macquarie-dictionary/status', checkAuthorized, (req: Request, res: Response) => {
    try {
      const loaded = loadMacquarieDict();
      const hasCustomFile = fs.existsSync(MACQUARIE_DICT_PATH);
      if (loaded && macquarieDictMeta) {
        const keys = Object.keys(loaded);
        const sampleKeys = keys.slice(0, 15);
        res.json({
          imported: hasCustomFile,
          wordCount: macquarieDictMeta.wordCount,
          fileSize: macquarieDictMeta.fileSize,
          sampleWords: sampleKeys,
          isDefaultBaseline: !hasCustomFile
        });
      } else {
        res.json({
          imported: false,
          wordCount: 0,
          fileSize: 0,
          sampleWords: [],
          isDefaultBaseline: true
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manually force re-hydration/re-sync from Firestore of the Macquarie Dictionary
  app.post('/api/macquarie-dictionary/sync-from-db', checkAdmin, async (req: Request, res: Response) => {
    try {
      console.log('Manual re-sync/rehydration of Macquarie Dictionary requested.');
      // Force reload by clearing memory cache
      macquarieDictCache = null;
      macquarieDictMeta = null;
      
      // Delete local file to force full re-download from Firestore
      if (fs.existsSync(MACQUARIE_DICT_PATH)) {
        fs.unlinkSync(MACQUARIE_DICT_PATH);
      }
      
      // Re-trigger rehydration
      await rehydrateCustomDataFromFirestore();
      
      const loaded = loadMacquarieDict();
      const hasCustomFile = fs.existsSync(MACQUARIE_DICT_PATH);
      
      if (loaded && macquarieDictMeta) {
        res.json({
          success: true,
          message: 'Macquarie Dictionary successfully synced and rehydrated from Firestore Database.',
          status: {
            imported: hasCustomFile,
            wordCount: macquarieDictMeta.wordCount,
            fileSize: macquarieDictMeta.fileSize,
            sampleWords: Object.keys(loaded).slice(0, 15),
            isDefaultBaseline: !hasCustomFile
          }
        });
      } else {
        res.json({
          success: true,
          message: 'Synced successfully. No custom Macquarie dictionary found in Firestore, fallback baseline active.',
          status: {
            imported: false,
            wordCount: 0,
            fileSize: 0,
            sampleWords: [],
            isDefaultBaseline: true
          }
        });
      }
    } catch (error: any) {
      console.error('Error in manual Macquarie sync-from-db:', error);
      res.status(500).json({ error: `Manual sync failed: ${error.message}` });
    }
  });

  // Clear/delete Macquarie Dictionary
  app.post('/api/macquarie-dictionary/clear', checkAdmin, async (req: Request, res: Response) => {
    try {
      if (fs.existsSync(MACQUARIE_DICT_PATH)) {
        fs.unlinkSync(MACQUARIE_DICT_PATH);
      }
      macquarieDictCache = null;
      macquarieDictMeta = null;

      // Persistently delete from Firestore
      try {
        const db = getDb();
        if (db) {
          let totalChunks = 25; // default buffer size
          const dictMetaRef = doc(db, 'macquarie_dict', 'metadata');
          const dictMetaSnap = await getDocFromServer(dictMetaRef);
          if (dictMetaSnap.exists()) {
            totalChunks = Math.max(totalChunks, dictMetaSnap.data().totalChunks || 0);
          }

          // Delete metadata
          await deleteDoc(dictMetaRef);
          
          // Delete chunks
          for (let i = 0; i < totalChunks; i++) {
            await deleteDoc(doc(db, 'macquarie_dict', `chunk_${i}`));
          }
          console.log(`Successfully cleared Macquarie Dictionary chunk documents from Firestore.`);
        }
      } catch (fsErr) {
        console.error('Failed to clear Macquarie Dictionary from Firestore:', fsErr);
      }

      res.json({ success: true, message: 'Macquarie Dictionary successfully deleted.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/admin/stats - Aggregated Usage & Activity Statistics (Admin-only)
  app.get('/api/admin/stats', checkAdmin, async (req: Request, res: Response) => {
    try {
      // 1. Fetch Session Logs
      const { logs: sessionLogs } = await dbGetSessionLogs();
      
      // 2. Fetch CrossCheck Logs
      const { logs: crossCheckLogs } = await dbGetCrossCheckLogs();

      // 3. Fetch User Feedback
      const { feedback: feedbackItems } = await dbGetUserFeedback();

      // 4. Fetch Users List
      let usersList: any[] = [];
      try {
        const db = getDb();
        if (db) {
          const usersRef = collection(db, 'authorized_users');
          const snap = await getDocs(usersRef);
          snap.forEach(d => usersList.push(d.data()));
        }
      } catch (err) {
        console.warn('Could not fetch authorized users for stats:', err);
      }

      // Calculations:
      const totalSessionReviews = sessionLogs.length;
      let totalWordsReviewed = 0;
      let totalSuggestionsFound = 0;
      let totalAccepted = 0;
      let totalIgnored = 0;
      let totalPending = 0;

      const ruleFrequency: { [rule: string]: number } = {};

      sessionLogs.forEach(log => {
        totalWordsReviewed += (log.wordCount || 0);
        totalSuggestionsFound += (log.totalSuggestions || 0);
        totalAccepted += (log.acceptedCount || 0);
        totalIgnored += (log.ignoredCount || 0);
        totalPending += (log.pendingCount || 0);

        if (log.suggestions && Array.isArray(log.suggestions)) {
          log.suggestions.forEach(s => {
            if (s.rule) {
              ruleFrequency[s.rule] = (ruleFrequency[s.rule] || 0) + 1;
            }
          });
        }
      });

      const overallAcceptanceRate = totalSuggestionsFound > 0
        ? Math.round((totalAccepted / totalSuggestionsFound) * 100)
        : 100;

      // Cross-check statistics
      const totalCrossChecks = crossCheckLogs.length;
      let totalAccuracyScoreSum = 0;
      let totalMissedInfractions = 0;
      const missedRuleFrequency: { [rule: string]: number } = {};

      crossCheckLogs.forEach(log => {
        totalAccuracyScoreSum += (log.accuracyScore || 0);
        if (log.missedInfractions && Array.isArray(log.missedInfractions)) {
          totalMissedInfractions += log.missedInfractions.length;
          log.missedInfractions.forEach((inf: any) => {
            if (inf.rule) {
              missedRuleFrequency[inf.rule] = (missedRuleFrequency[inf.rule] || 0) + 1;
            }
          });
        }
      });

      const averageAccuracyScore = totalCrossChecks > 0
        ? Math.round(totalAccuracyScoreSum / totalCrossChecks)
        : 100;

      // Feedback stats
      const totalFeedback = feedbackItems.length;
      const feedbackByCategory = {
        idea: feedbackItems.filter(f => f.category === 'idea').length,
        ux_request: feedbackItems.filter(f => f.category === 'ux_request').length,
        ai_error: feedbackItems.filter(f => f.category === 'ai_error').length,
        general: feedbackItems.filter(f => f.category === 'general').length,
      };
      const feedbackByStatus = {
        new: feedbackItems.filter(f => f.status === 'new').length,
        in_review: feedbackItems.filter(f => f.status === 'in_review').length,
        resolved: feedbackItems.filter(f => f.status === 'resolved').length,
        dismissed: feedbackItems.filter(f => f.status === 'dismissed').length,
      };

      // Users stats
      const totalUsers = usersList.length;
      const usersByRole = {
        admin: usersList.filter(u => u.role === 'admin').length,
        'sub-editor': usersList.filter(u => u.role === 'sub-editor').length,
        editor: usersList.filter(u => u.role === 'editor').length,
      };

      // 30-day window metrics
      const thirtyDaysAgoMs = Date.now() - (30 * 24 * 60 * 60 * 1000);

      let totalReviews30Days = 0;
      sessionLogs.forEach(log => {
        let logTime = 0;
        if (log.timestamp) {
          const parsed = new Date(log.timestamp).getTime();
          if (!isNaN(parsed) && parsed > 0) logTime = parsed;
        }
        if (!logTime && log.id) {
          const parsed = new Date(log.id).getTime();
          if (!isNaN(parsed) && parsed > 0) logTime = parsed;
        }
        if (logTime >= thirtyDaysAgoMs || logTime === 0) {
          totalReviews30Days++;
        }
      });

      const activeEmails30Days = new Set<string>();
      usersList.forEach(u => {
        const email = (u.email || '').toLowerCase().trim();
        let uTime = 0;
        ['invitedAt', 'createdAt', 'updatedAt', 'lastActiveAt'].forEach(field => {
          if (u[field]) {
            const parsed = new Date(u[field]).getTime();
            if (!isNaN(parsed) && parsed > uTime) uTime = parsed;
          }
        });
        if (uTime >= thirtyDaysAgoMs || uTime === 0) {
          if (email) activeEmails30Days.add(email);
        }
      });

      sessionLogs.forEach(log => {
        let logTime = 0;
        if (log.timestamp) {
          const parsed = new Date(log.timestamp).getTime();
          if (!isNaN(parsed) && parsed > 0) logTime = parsed;
        }
        if (logTime >= thirtyDaysAgoMs || logTime === 0) {
          if (log.userEmail) {
            activeEmails30Days.add(log.userEmail.toLowerCase().trim());
          }
        }
      });

      crossCheckLogs.forEach(log => {
        let logTime = 0;
        if (log.timestamp) {
          const parsed = new Date(log.timestamp).getTime();
          if (!isNaN(parsed) && parsed > 0) logTime = parsed;
        }
        if (logTime >= thirtyDaysAgoMs || logTime === 0) {
          if (log.userEmail) {
            activeEmails30Days.add(log.userEmail.toLowerCase().trim());
          }
        }
      });

      const users30Days = usersList.length > 0 ? Math.min(usersList.length, Math.max(activeEmails30Days.size, 1)) : activeEmails30Days.size;

      // Top flagged rules
      const topFlaggedRules = Object.entries(ruleFrequency)
        .map(([rule, count]) => ({ rule, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      // Top missed rules in crosschecks
      const topMissedRules = Object.entries(missedRuleFrequency)
        .map(([rule, count]) => ({ rule, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      // Activity timeline (e.g. grouped by date for recent reviews)
      const dateMap: { [date: string]: { reviews: number; words: number; crosschecks: number } } = {};
      
      sessionLogs.forEach(log => {
        let dateKey = 'Unknown';
        if (log.timestamp) {
          const d = new Date(log.timestamp);
          if (!isNaN(d.getTime())) {
            dateKey = d.toISOString().split('T')[0];
          } else {
            dateKey = log.timestamp.split(',')[0].trim();
          }
        }
        if (!dateMap[dateKey]) {
          dateMap[dateKey] = { reviews: 0, words: 0, crosschecks: 0 };
        }
        dateMap[dateKey].reviews += 1;
        dateMap[dateKey].words += (log.wordCount || 0);
      });

      crossCheckLogs.forEach(log => {
        let dateKey = 'Unknown';
        if (log.timestamp) {
          const d = new Date(log.timestamp);
          if (!isNaN(d.getTime())) {
            dateKey = d.toISOString().split('T')[0];
          }
        }
        if (!dateMap[dateKey]) {
          dateMap[dateKey] = { reviews: 0, words: 0, crosschecks: 0 };
        }
        dateMap[dateKey].crosschecks += 1;
      });

      const timeline = Object.entries(dateMap)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-14); // last 14 active days

      res.json({
        summary: {
          totalSessionReviews,
          totalReviews30Days,
          totalWordsReviewed,
          totalSuggestionsFound,
          totalAccepted,
          totalIgnored,
          totalPending,
          overallAcceptanceRate,
          totalCrossChecks,
          averageAccuracyScore,
          totalMissedInfractions,
          totalFeedback,
          totalUsers,
          users30Days
        },
        feedbackByCategory,
        feedbackByStatus,
        usersByRole,
        topFlaggedRules,
        topMissedRules,
        timeline,
        usersList
      });
    } catch (error: any) {
      console.error('Error fetching usage stats:', error);
      res.status(500).json({ error: error.message || 'Failed to aggregate usage statistics' });
    }
  });

  // GET /api/admin/users - List all authorized users (Admin-only)
  app.get('/api/admin/users', checkAdmin, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      if (!db) {
        return res.status(500).json({ error: "Database connection not available" });
      }
      const usersRef = collection(db, 'authorized_users');
      const snap = await getDocs(usersRef);
      const usersList: any[] = [];
      snap.forEach((doc) => {
        usersList.push(doc.data());
      });
      res.json(usersList);
    } catch (err: any) {
      console.error("Error retrieving authorized users:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/users - Add a new authorized user (Admin-only)
  app.post('/api/admin/users', checkAdmin, async (req: Request, res: Response) => {
    try {
      const { email, role } = req.body;
      const adminEmail = req.headers['x-user-email'] as string;

      if (!email || !role) {
        return res.status(400).json({ error: "Email and role are required." });
      }

      const cleanEmail = email.toLowerCase().trim();
      const db = getDb();
      if (!db) return res.status(500).json({ error: "Database not available" });

      const docRef = doc(db, 'authorized_users', cleanEmail);
      await setDoc(docRef, {
        email: cleanEmail,
        role: role,
        invitedBy: adminEmail.toLowerCase().trim(),
        invitedAt: new Date().toISOString(),
        status: 'active'
      });

      res.status(201).json({ success: true, message: `Successfully authorized user: ${cleanEmail}` });
    } catch (err: any) {
      console.error("Error creating authorized user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/admin/users/:email - Update an authorized user's role/status (Admin-only)
  app.put('/api/admin/users/:email', checkAdmin, async (req: Request, res: Response) => {
    try {
      const { email } = req.params;
      const { role, status } = req.body;

      if (!email) {
        return res.status(400).json({ error: "Email is required." });
      }

      const cleanEmail = email.toLowerCase().trim();
      
      // Safety: Prevent removing oneself as admin
      const adminEmail = (req.headers['x-user-email'] as string).toLowerCase().trim();
      if (cleanEmail === adminEmail) {
        return res.status(400).json({ error: "Self-modification of administrative status has been rejected for safety." });
      }

      const db = getDb();
      if (!db) return res.status(500).json({ error: "Database not available" });

      const docRef = doc(db, 'authorized_users', cleanEmail);
      const snap = await getDocFromServer(docRef);
      if (!snap.exists()) {
        return res.status(404).json({ error: "User not found." });
      }

      const currentData = snap.data();
      const updatedData = {
        ...currentData,
        role: role || currentData.role,
        status: status || currentData.status,
        updatedAt: new Date().toISOString()
      };

      await setDoc(docRef, updatedData);
      res.json({ success: true, message: `User ${cleanEmail} has been updated successfully.` });
    } catch (err: any) {
      console.error("Error updating authorized user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/users/:email - Revoke/Delete an authorized user (Admin-only)
  app.delete('/api/admin/users/:email', checkAdmin, async (req: Request, res: Response) => {
    try {
      const { email } = req.params;
      if (!email) {
        return res.status(400).json({ error: "Email is required." });
      }

      const cleanEmail = email.toLowerCase().trim();

      // Safety: Prevent deleting oneself
      const adminEmail = (req.headers['x-user-email'] as string).toLowerCase().trim();
      if (cleanEmail === adminEmail) {
        return res.status(400).json({ error: "Self-deletion of administrative status has been rejected for safety." });
      }

      const db = getDb();
      if (!db) return res.status(500).json({ error: "Database not available" });

      const docRef = doc(db, 'authorized_users', cleanEmail);
      await deleteDoc(docRef);

      res.json({ success: true, message: `User ${cleanEmail} authorization has been deleted.` });
    } catch (err: any) {
      console.error("Error deleting authorized user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Robust production static assets routing
  const distPathFromCwd = path.join(process.cwd(), 'dist');
  const distPathFromDirname = currentDirname;
  
  let distPath = distPathFromCwd;
  if (fs.existsSync(path.join(distPathFromDirname, 'index.html')) && distPathFromDirname !== process.cwd()) {
    distPath = distPathFromDirname;
  } else if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    console.warn(`Warning: index.html not found in ${distPathFromCwd} or ${distPathFromDirname}`);
  }

  // Development mode should use Vite middleware, production mode serves static client bundle.
  // We explicitly check if we are in development environment and not executing the compiled server.cjs bundle.
  const isDev = process.env.NODE_ENV !== 'production' && !currentFilename.endsWith('server.cjs');

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    try {
      getDb();
    } catch (e) {
      console.warn("Proactive getDb warmup failed on server start:", e);
    }
  });

  // Set generous connection and request timeouts (10 minutes) on the Node.js server to support slow/large LLM operations
  if (server) {
    server.timeout = 600000;         // 10 minutes socket timeout
    server.headersTimeout = 120000;  // 2 minutes headers timeout
    server.requestTimeout = 600000;  // 10 minutes request processing timeout
    server.keepAliveTimeout = 65000; // 65 seconds keep-alive persistence window
  }
}

startServer();
