import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { 
  Search, CheckCircle2, AlertCircle, Sparkles, Layout, 
  Copy, ClipboardCheck, ArrowLeft, RefreshCw, FileText, 
  HelpCircle, Trash2, ToggleLeft, ToggleRight, Check, X,
  Undo2, Play, Flame, PenTool, History, ChevronLeft, ChevronRight,
  Database, Download, Users, Lock, ShieldAlert, ShieldCheck, LogOut,
  MessageSquarePlus, MessageSquare, Send, MessageCircle, BarChart3,
  TrendingUp, PieChart, Activity, FileCheck, Calendar, Award
} from 'lucide-react';

interface StyleIssue {
  original: string;
  rule: string;
  issue: string;
  fix: string;
  isNote: boolean;
  status?: 'pending' | 'accepted' | 'rejected';
  type?: 'style' | 'consistency' | 'dictionary';
  prefixText?: string;
  suffixText?: string;
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
  suggestions?: StyleIssue[];
}

type ThemeType = 'light' | 'dark';

const THEMES = {
  light: {
    container: "bg-[#FAF9F6] text-zinc-900 h-screen w-screen flex flex-col font-sans overflow-hidden border border-zinc-200/80 max-w-7xl mx-auto shadow-2xl relative transition-all duration-300",
    header: "border-b border-zinc-200/80 px-4 md:px-6 py-3 flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white shrink-0 gap-3 transition-all duration-300",
    footer: "border-t border-zinc-200/80 px-4 md:px-6 py-2.5 flex flex-col sm:flex-row justify-between items-center bg-white shrink-0 gap-2 transition-all duration-300",
    title: "text-zinc-950 font-black tracking-tight uppercase leading-none m-0 text-lg md:text-xl",
    textMuted: "text-zinc-400 font-mono text-[10px] uppercase tracking-widest",
    accentText: "text-[#0055FF]",
    sidebarHeader: "bg-zinc-950 text-white py-3 px-6 flex items-center justify-between shrink-0",
    sidebarBorder: "border-r border-zinc-200/80",
    sidebarBg: "bg-zinc-50/50",
    sidebarCardSelected: "ring-2 ring-zinc-950 shadow-md translate-x-1",
    sidebarCardHover: "hover:border-zinc-805",
    workspaceToolbar: "bg-zinc-950 text-white py-2.5 px-4 md:px-6 flex flex-wrap gap-3 justify-between items-center shrink-0",
    stageBg: "bg-[#FAF9F6]",
    paper: "max-w-2xl w-full flex flex-col bg-white p-8 lg:p-12 border border-zinc-200/80 shadow-sm relative shrink-0",
    fixedBtn: "bg-white text-zinc-900 border border-zinc-300 hover:bg-zinc-950 hover:text-white active:translate-y-0.5",
    textInputBg: "bg-white border border-zinc-200/80 shadow-sm flex flex-col p-6 min-h-[350px]"
  },
  dark: {
    container: "bg-[#09090B] text-zinc-100 h-screen w-screen flex flex-col font-sans overflow-hidden border border-zinc-800 max-w-7xl mx-auto shadow-2xl relative transition-all duration-300",
    header: "border-b border-zinc-800/80 px-4 md:px-6 py-3 flex flex-col lg:flex-row justify-between items-start lg:items-center bg-[#121214] shrink-0 gap-3 transition-all duration-300",
    footer: "border-t border-zinc-800/80 px-4 md:px-6 py-2.5 flex flex-col sm:flex-row justify-between items-center bg-[#121214] shrink-0 gap-2 transition-all duration-300",
    title: "text-[#F4F4F5] font-black tracking-tight uppercase leading-none m-0 text-lg md:text-xl",
    textMuted: "text-zinc-500 font-mono text-[10px] uppercase tracking-widest font-semibold",
    accentText: "text-blue-400",
    sidebarHeader: "bg-[#121214] text-zinc-100 border-b border-zinc-800/80 py-3 px-6 flex items-center justify-between shrink-0",
    sidebarBorder: "border-r border-zinc-800/80",
    sidebarBg: "bg-[#0B0B0D]",
    sidebarCardSelected: "ring-2 ring-blue-500/85 shadow-lg translate-x-1",
    sidebarCardHover: "hover:border-zinc-700 hover:bg-[#18181C]",
    workspaceToolbar: "bg-[#121214] text-zinc-100 border-b border-zinc-800/80 py-2.5 px-4 md:px-6 flex flex-wrap gap-3 justify-between items-center shrink-0",
    stageBg: "bg-[#09090B]",
    paper: "max-w-2xl w-full flex flex-col bg-[#121214] p-8 lg:p-12 border border-zinc-800/80 shadow-[0_8px_30px_rgb(0,0,0,0.5)] relative shrink-0",
    fixedBtn: "bg-[#1C1C1F] text-zinc-100 border border-zinc-750 hover:bg-zinc-800 active:translate-y-0.5 transition-all",
    textInputBg: "bg-[#121214] border border-zinc-805 shadow-inner flex flex-col p-6 min-h-[350px]"
  }
};

const findFuzzyMatch = (text: string, original: string): { index: number; length: number } | null => {
  if (!text || !original) return null;
  
  // 1. Try exact match first
  const exactIndex = text.indexOf(original);
  if (exactIndex !== -1) {
    return { index: exactIndex, length: original.length };
  }

  // 2. Try normalized whitespace match
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normOriginal = normalize(original);
  
  if (normOriginal.length < 8) return null;

  // Track map of indices of non-whitespace characters from text to their original indices
  let cleanText = '';
  const textMapping: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      cleanText += text[i];
      textMapping.push(i);
    }
  }

  let cleanOriginal = '';
  for (let i = 0; i < original.length; i++) {
    if (!/\s/.test(original[i])) {
      cleanOriginal += original[i];
    }
  }

  const cleanIndex = cleanText.indexOf(cleanOriginal);
  if (cleanIndex !== -1) {
    const startIdx = textMapping[cleanIndex];
    const endIdx = textMapping[cleanIndex + cleanOriginal.length - 1];
    return { index: startIdx, length: endIdx - startIdx + 1 };
  }

  // 3. Sliding window word/spelling overlap matching (e.g. for minor spelling differences)
  const getWords = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) || [];
  const origWords = getWords(original);
  if (origWords.length < 3) return null; // Need sufficient words to identify context reliably

  const textWordsWithIndices: { word: string; start: number; end: number }[] = [];
  const wordRegex = /[a-z0-9]+/gi;
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    textWordsWithIndices.push({
      word: match[0].toLowerCase(),
      start: match.index,
      end: wordRegex.lastIndex
    });
  }

  if (textWordsWithIndices.length === 0) return null;

  const targetWords = origWords;
  const targetLen = targetWords.length;
  let bestScore = 0;
  let bestStartIdx = -1;
  let bestEndIdx = -1;

  for (let i = 0; i < textWordsWithIndices.length; i++) {
    for (let w = Math.max(1, targetLen - 3); w <= targetLen + 3; w++) {
      if (i + w > textWordsWithIndices.length) break;
      
      const windowWords = textWordsWithIndices.slice(i, i + w).map(x => x.word);
      let matchCount = 0;
      const windowSet = new Set(windowWords);
      for (const tw of targetWords) {
        if (windowSet.has(tw)) matchCount++;
      }
      
      const score = matchCount / Math.max(targetLen, windowWords.length);
      if (score > bestScore) {
        bestScore = score;
        bestStartIdx = textWordsWithIndices[i].start;
        bestEndIdx = textWordsWithIndices[i + w - 1].end;
      }
    }
  }

  if (bestScore >= 0.65 && bestStartIdx !== -1 && bestEndIdx !== -1) {
    return { index: bestStartIdx, length: bestEndIdx - bestStartIdx };
  }

  return null;
};

const formatMarkdownToHtml = (text: string): string => {
  if (!text) return '';
  // Convert [text](url) to <a href="url">text</a>
  let formatted = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #0055FF; text-decoration: underline;">$1</a>');
  // Convert ***text*** to <strong><em>text</em></strong>
  formatted = formatted.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Convert **text** to <strong>text</strong>
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Convert *text* to <em>text</em>
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Convert __text__ to <strong>text</strong>
  formatted = formatted.replace(/__(.*?)__/g, '<strong>$1</strong>');
  // Convert _text_ to <em>text</em>
  formatted = formatted.replace(/_(.*?)_/g, '<em>$1</em>');
  return formatted;
};

const replaceInHtml = (html: string, search: string, replacement: string): string => {
  if (!html || !search) return html;
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // 1. Collect all text nodes and construct a combined text string
  const textNodes: { node: Node; start: number; end: number }[] = [];
  let combinedText = '';

  const walkToCollect = (node: Node) => {
    if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') return;

    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.nodeValue || '';
      if (val.length > 0) {
        textNodes.push({
          node,
          start: combinedText.length,
          end: combinedText.length + val.length
        });
        combinedText += val;
      }
    } else {
      for (const child of Array.from(node.childNodes)) {
        walkToCollect(child);
      }
    }
  };

  walkToCollect(doc.body);

  // Strip style markdown characters (asterisks, underscores) to perform safe clean search matching
  let cleanSearch = search.replace(/[\*_]/g, '');
  // Strip markdown links [text](url) to just text
  cleanSearch = cleanSearch.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 2. Search for the query in combinedText
  let matchIndex = combinedText.indexOf(cleanSearch);
  let matchLength = cleanSearch.length;

  if (matchIndex === -1) {
    const fuzzy = findFuzzyMatch(combinedText, cleanSearch);
    if (fuzzy) {
      matchIndex = fuzzy.index;
      matchLength = fuzzy.length;
    }
  }

  // 3. Match found - replace across mapped text nodes
  if (matchIndex !== -1) {
    const matchEnd = matchIndex + matchLength;
    let replacementInserted = false;

    for (const textNodeInfo of textNodes) {
      const { node, start, end } = textNodeInfo;
      const overlapStart = Math.max(start, matchIndex);
      const overlapEnd = Math.min(end, matchEnd);

      if (overlapStart < overlapEnd) {
        const originalVal = node.nodeValue || '';
        const nodeOverlapStart = overlapStart - start;
        const nodeOverlapEnd = overlapEnd - start;

        const beforeMatch = originalVal.slice(0, nodeOverlapStart);
        const afterMatch = originalVal.slice(nodeOverlapEnd);

        if (!replacementInserted) {
          const parent = node.parentNode;
          if (parent) {
            const container = doc.createElement('div');
            container.innerHTML = formatMarkdownToHtml(replacement);
            
            const preNode = doc.createTextNode(beforeMatch);
            const postNode = doc.createTextNode(afterMatch);
            
            parent.insertBefore(preNode, node);
            while (container.firstChild) {
              parent.insertBefore(container.firstChild, node);
            }
            parent.replaceChild(postNode, node);
          }
          replacementInserted = true;
        } else {
          node.nodeValue = beforeMatch + afterMatch;
        }
      }
    }
    return doc.body.innerHTML;
  }

  return html;
};

const isAdvisoryInstruction = (fix: string): boolean => {
  if (!fix || !fix.trim()) return true;
  const f = fix.trim();
  if (/^(Standardize|Consider|Ensure|Verify|Check|Note:|Optionally|Rephrase|Choose|Decide|Select|Adjust|Change to|Use either|Suggest|Recommend)/i.test(f)) {
    return true;
  }
  if (/\b(across both|in the text|for consistency|or similar|either .+ or .+|both paragraphs|both sentences|in both|across the document)\b/i.test(f)) {
    return true;
  }
  if (f.length > 70 && /[.!?]/.test(f)) {
    return true;
  }
  return false;
};

const parseSuggestionsFromMarkdown = (markdown: string): StyleIssue[] => {
  const issuesList: StyleIssue[] = [];
  if (!markdown) return issuesList;

  const getIssueTypeFromRule = (rule: string): 'style' | 'consistency' | 'dictionary' => {
    const r = rule.toLowerCase();
    if (r.includes('consistency') || r.includes('context') || r.includes('completeness')) {
      return 'consistency';
    }
    if (r.includes('dictionary') || r.includes('banned') || r.includes('macquarie') || r.includes('spelling match')) {
      return 'dictionary';
    }
    return 'style';
  };

  // Regex to match Accepted suggestions
  const acceptedRegex = /###\s+\[Accepted\s+#\d+\]\s+Rule\s+Group:\s*([^\n]+)\n-\s+Found\s+Text:\s*"([\s\S]*?)"\n-\s+Corrected\s+To:\s*"([\s\S]*?)"\n-\s+AI\s+Comment:\s*([^\n]*)/gi;
  let match;
  while ((match = acceptedRegex.exec(markdown)) !== null) {
    const ruleStr = match[1].trim();
    const fixStr = match[3];
    const isConsistency = ruleStr.toLowerCase().includes('consistency');
    const isAdv = isConsistency || !fixStr || isAdvisoryInstruction(fixStr);
    issuesList.push({
      rule: ruleStr,
      original: match[2],
      fix: isAdvisoryInstruction(fixStr) ? '' : fixStr,
      issue: match[4].trim(),
      isNote: isAdv,
      status: 'accepted',
      type: getIssueTypeFromRule(ruleStr)
    });
  }

  // Regex to match Ignored suggestions
  const ignoredRegex = /###\s+\[Ignored\s+#\d+\]\s+Rule\s+Group:\s*([^\n]+)\n-\s+Found\s+Text:\s*"([\s\S]*?)"\n-\s+Suggested\s+Fix:\s*"([\s\S]*?)"\n-\s+AI\s+Comment:\s*([^\n]*)/gi;
  while ((match = ignoredRegex.exec(markdown)) !== null) {
    const ruleStr = match[1].trim();
    const fixStr = match[3];
    const isConsistency = ruleStr.toLowerCase().includes('consistency');
    const isAdv = isConsistency || !fixStr || isAdvisoryInstruction(fixStr);
    issuesList.push({
      rule: ruleStr,
      original: match[2],
      fix: isAdvisoryInstruction(fixStr) ? '' : fixStr,
      issue: match[4].trim(),
      isNote: isAdv,
      status: 'rejected',
      type: getIssueTypeFromRule(ruleStr)
    });
  }

  // Regex to match Pending suggestions
  const pendingRegex = /###\s+\[Pending\s+#\d+\]\s+Rule\s+Group:\s*([^\n]+)\n-\s+Found\s+Text:\s*"([\s\S]*?)"\n-\s+Suggested\s+Fix:\s*"([\s\S]*?)"\n-\s+AI\s+Comment:\s*([^\n]*)/gi;
  while ((match = pendingRegex.exec(markdown)) !== null) {
    const ruleStr = match[1].trim();
    const fixStr = match[3];
    const isConsistency = ruleStr.toLowerCase().includes('consistency');
    const isAdv = isConsistency || !fixStr || isAdvisoryInstruction(fixStr);
    issuesList.push({
      rule: ruleStr,
      original: match[2],
      fix: isAdvisoryInstruction(fixStr) ? '' : fixStr,
      issue: match[4].trim(),
      isNote: isAdv,
      status: 'pending',
      type: getIssueTypeFromRule(ruleStr)
    });
  }

  return issuesList;
};

const cleanPastedHtml = (rawHtml: string): string => {
  if (!rawHtml) return '';

  const parser = new DOMParser();
  let cleanedRaw = rawHtml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  const doc = parser.parseFromString(cleanedRaw, 'text/html');

  const badSelectors = 'script, style, meta, link, xml, o\\:p, head, title';
  doc.body.querySelectorAll(badSelectors).forEach(el => el.remove());

  const checkFormatting = (el: HTMLElement) => {
    const tag = el.tagName;
    const styleAttr = el.getAttribute('style') || '';
    const styleLower = styleAttr.toLowerCase();
    const classAttr = (el.getAttribute('class') || '').toLowerCase();

    const isItalic = tag === 'I' || tag === 'EM' ||
      styleLower.includes('font-style:italic') ||
      styleLower.includes('font-style: italic') ||
      styleLower.includes('mso-bidi-font-style:italic') ||
      styleLower.includes('mso-bidi-font-style: italic') ||
      classAttr.includes('italic');

    const isBold = tag === 'B' || tag === 'STRONG' ||
      styleLower.includes('font-weight:bold') ||
      styleLower.includes('font-weight: bold') ||
      styleLower.includes('font-weight:700') ||
      styleLower.includes('font-weight: 700') ||
      styleLower.includes('font-weight:600') ||
      styleLower.includes('font-weight: 600') ||
      classAttr.includes('bold');

    const isUnderline = tag === 'U' || tag === 'INS' ||
      styleLower.includes('text-decoration:underline') ||
      styleLower.includes('text-decoration: underline');

    let highlightBg = '';
    if (tag === 'MARK') {
      highlightBg = '#fef08a';
    } else if (styleLower.includes('mso-highlight:') || styleLower.includes('background:') || styleLower.includes('background-color:')) {
      const bgMatch = styleAttr.match(/(?:background-color|background|mso-highlight)\s*:\s*([^;"]+)/i);
      if (bgMatch && bgMatch[1]) {
        const val = bgMatch[1].trim().toLowerCase();
        if (val !== 'transparent' && val !== 'none' && val !== 'initial' && val !== 'inherit' && val !== 'white' && val !== '#ffffff' && val !== 'rgb(255, 255, 255)' && val !== 'rgba(0, 0, 0, 0)') {
          highlightBg = val;
        }
      }
    }

    const isLink = tag === 'A' && el.hasAttribute('href');

    return { isItalic, isBold, isUnderline, highlightBg, isLink };
  };

  const processNode = (node: Node): Node | Node[] | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const val = (node.nodeValue || '').replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
      return doc.createTextNode(val);
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName;

      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'XML', 'HEAD', 'TITLE'].includes(tag)) {
        return null;
      }

      const { isItalic, isBold, isUnderline, highlightBg, isLink } = checkFormatting(el);

      const childNodesArr = Array.from(el.childNodes);
      const processedChildren: Node[] = [];
      for (const child of childNodesArr) {
        const res = processNode(child);
        if (res) {
          if (Array.isArray(res)) {
            processedChildren.push(...res);
          } else {
            processedChildren.push(res);
          }
        }
      }

      if (processedChildren.length === 0 && !['BR', 'HR', 'IMG'].includes(tag)) {
        return null;
      }

      if (tag === 'BR') {
        return doc.createElement('br');
      }

      const isBlock = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI'].includes(tag);

      let container: HTMLElement | null = null;
      let innermost: HTMLElement | null = null;

      const wrapTag = (newTag: string, attributes?: Record<string, string>) => {
        const newEl = doc.createElement(newTag);
        if (attributes) {
          Object.entries(attributes).forEach(([k, v]) => newEl.setAttribute(k, v));
        }
        if (!container) {
          container = newEl;
          innermost = newEl;
        } else if (innermost) {
          innermost.appendChild(newEl);
          innermost = newEl;
        }
      };

      if (isBlock) {
        wrapTag('p', { style: 'margin-bottom: 12pt; line-height: 1.65; font-family: Aptos, Arial, sans-serif;' });
      }

      if (isLink) {
        const href = el.getAttribute('href') || '';
        wrapTag('a', { href, target: '_blank', style: 'color: #0055FF; text-decoration: underline;' });
      }

      if (isBold) wrapTag('strong');
      if (isItalic) wrapTag('em');
      if (isUnderline) wrapTag('u');
      if (highlightBg) {
        wrapTag('mark', { style: `background-color: ${highlightBg}; padding: 0 2px; border-radius: 2px;` });
      }

      if (container && innermost) {
        processedChildren.forEach(c => innermost!.appendChild(c));
        return container;
      } else {
        return processedChildren;
      }
    }

    return null;
  };

  const finalContainer = doc.createElement('div');
  const bodyChildren = Array.from(doc.body.childNodes);
  for (const child of bodyChildren) {
    const res = processNode(child);
    if (res) {
      if (Array.isArray(res)) {
        res.forEach(n => finalContainer.appendChild(n));
      } else {
        finalContainer.appendChild(res);
      }
    }
  }

  let resultHtml = finalContainer.innerHTML.trim();
  if (!resultHtml) return '';

  return resultHtml;
};

const cleanParagraphs = (text: string): string => {
  if (!text) return '';
  // Normalize Windows CRLF first
  let normalized = text.replace(/\r\n/g, '\n');
  // Collapse sequence of 3 or more newlines down to exactly 2 newlines (prevent endless spacing loop)
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  return normalized;
};

const htmlToPlainText = (html: string, options?: { preserveMarkdown?: boolean }): string => {
  if (!html) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  let text = '';
  
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName;
      
      const isItalic = !!(options?.preserveMarkdown && (
        tag === 'EM' || tag === 'I' || 
        el.style.fontStyle === 'italic' || 
        el.getAttribute('style')?.includes('font-style: italic') || 
        el.className?.includes('italic')
      ));
      
      const isBold = !!(options?.preserveMarkdown && (
        tag === 'STRONG' || tag === 'B' || 
        el.style.fontWeight === 'bold' || 
        el.getAttribute('style')?.includes('font-weight: bold') || 
        el.className?.includes('font-bold') ||
        (el.style.fontWeight && parseInt(el.style.fontWeight) >= 600)
      ));
      
      const isLink = !!(options?.preserveMarkdown && tag === 'A');

      if (isItalic) text += '*';
      if (isBold) text += '**';
      if (isLink) text += '[';

      if (tag === 'BR') {
        text += '\n';
      } else if (tag === 'P' || tag === 'DIV' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'BLOCKQUOTE') {
        if (text && !text.endsWith('\n')) {
          text += '\n';
        }
        for (const child of Array.from(el.childNodes)) {
          walk(child);
        }
        if (!text.endsWith('\n')) {
          text += '\n';
        }
      } else {
        for (const child of Array.from(el.childNodes)) {
          walk(child);
        }
      }

      if (isLink) {
        const href = el.getAttribute('href') || '';
        text += `](${href})`;
      }
      if (isBold) text += '**';
      if (isItalic) text += '*';
    }
  };
  
  walk(doc.body);
  
  let cleaned = text.trim();
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned;
};

const generateParagraphHtml = (text: string): string => {
  const normalized = cleanParagraphs(text);
  return normalized
    .split('\n\n')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      const formatted = formatMarkdownToHtml(p).replace(/\n/g, '<br>');
      return `<p style="margin-bottom: 12pt; line-height: 1.65; font-family: Aptos, Arial, sans-serif;">${formatted}</p>`;
    })
    .join('');
};

const prepareHtmlForClipboard = (html: string): string => {
  if (!html) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // 1. Remove empty paragraphs or divs that are used as manual spacing so they don't cause double spacing in Word.
  // We identify empty blocks as those with no text content (ignoring whitespace and non-breaking spaces)
  // and no media/interactive elements (like images, svgs, inputs, buttons, etc.).
  const blocks = doc.querySelectorAll('p, div');
  blocks.forEach(block => {
    const textContent = (block.textContent || '').replace(/[\s\u00a0]/g, '');
    const hasMedia = block.querySelector('img, input, button, iframe, canvas, svg') !== null;
    if (textContent.length === 0 && !hasMedia && block.parentElement) {
      block.parentNode?.removeChild(block);
    }
  });

  // 2. Ensure remaining paragraph tags have clean styled margins so word processors recognize paragraph separation
  const paragraphs = doc.querySelectorAll('p');
  paragraphs.forEach(p => {
    const existingStyle = p.getAttribute('style') || '';
    if (!existingStyle) {
      p.setAttribute('style', 'margin-bottom: 12pt; line-height: 1.65; font-family: Aptos, Arial, sans-serif;');
    } else if (existingStyle.includes('1.25em')) {
      p.setAttribute('style', existingStyle.replace(/1.25em/g, '12pt'));
    }
  });

  const divs = doc.querySelectorAll('div');
  divs.forEach(d => {
    const existingStyle = d.getAttribute('style') || '';
    if (d.parentElement === doc.body && !existingStyle) {
      d.setAttribute('style', 'margin-bottom: 12pt; line-height: 1.65; font-family: Aptos, Arial, sans-serif;');
    } else if (existingStyle.includes('1.25em')) {
      d.setAttribute('style', existingStyle.replace(/1.25em/g, '12pt'));
    }
  });
  
  // Use standard CF_HTML compatible markers (<!--StartFragment--> and <!--EndFragment-->) inside <html><body>
  // and omit <!DOCTYPE html> and <head> structures which corrupt MS Word's nested document importer.
  return `<html><body><!--StartFragment-->${doc.body.innerHTML}<!--EndFragment--></body></html>`;
};

const getHighlightedHtml = (
  html: string, 
  allIssues: (StyleIssue & { idx: number })[],
  selectedIssueIndex: number | null,
  theme: string
): string => {
  if (!html) return '';
  if (allIssues.length === 0) return html;
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Track which issues have been placed to avoid duplicate highlighting for the same issue
  const matchedIssues = new Set<number>();
  
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || '';
      const parent = node.parentNode;
      if (parent && (parent.nodeName === 'BUTTON' || parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE')) {
        return;
      }
      
      for (const issue of allIssues) {
        if (matchedIssues.has(issue.idx)) continue;
        
        const isAccepted = issue.status === 'accepted';
        const isIgnored = issue.status === 'rejected';
        const rawTargetText = isAccepted ? (issue.fix || '') : issue.original;
        if (!rawTargetText || rawTargetText.trim().length === 0) continue;
        
        // Strip style markdown characters to match rendered HTML text nodes
        let original = rawTargetText.replace(/[\*_]/g, '');
        // Strip markdown links [text](url) to just text
        original = original.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        
        if (!original || original.trim().length === 0) continue;
        
        let index = -1;
        let matchLength = 0;

        // Try exact match first
        index = text.indexOf(original);
        if (index !== -1) {
          matchLength = original.length;
        } else {
          // Normalize quotes (smart to straight) to improve matching
          const normalizeQuotes = (s: string) => s.replace(/[\u2018\u2019`]/g, "'").replace(/[\u201C\u201D]/g, '"');
          const normText = normalizeQuotes(text);
          const normOriginal = normalizeQuotes(original);
          
          index = normText.indexOf(normOriginal);
          if (index !== -1) {
             matchLength = original.length;
          } else {
             // Try stripping wrapping quotes from original
             if ((normOriginal.startsWith('"') && normOriginal.endsWith('"')) || (normOriginal.startsWith("'") && normOriginal.endsWith("'"))) {
                const unquoted = normOriginal.slice(1, -1);
                index = normText.indexOf(unquoted);
                if (index !== -1) {
                  matchLength = unquoted.length;
                }
             }
          }
        }

        if (index !== -1 && matchLength > 0) {
          matchedIssues.add(issue.idx);
          const preText = text.slice(0, index);
          const matchText = text.slice(index, index + matchLength);
          const postText = text.slice(index + matchLength);
          
          const preNode = doc.createTextNode(preText);
          const matchBtn = doc.createElement('button');
          matchBtn.setAttribute('data-issue-idx', String(issue.idx));
          
          let btnClasses = '';
          const isSelected = selectedIssueIndex === issue.idx;
          const isNote = issue.isNote;

          if (theme === 'dark') {
            if (isAccepted) {
              btnClasses = isSelected
                ? 'bg-emerald-900/90 text-emerald-100 border-b-2 border-emerald-500 ring-2 ring-emerald-700/80 font-semibold px-1.5 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                : 'bg-emerald-950/40 text-emerald-300 border-b border-dashed border-emerald-700/60 hover:bg-emerald-950/70 px-1 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5';
            } else if (isIgnored) {
              btnClasses = isSelected
                ? 'bg-zinc-800 text-zinc-100 border-b-2 border-zinc-500 ring-2 ring-zinc-700/80 font-semibold px-1.5 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                : 'bg-zinc-900/30 text-zinc-400 border-b border-dashed border-zinc-700/50 hover:bg-zinc-800/40 px-1 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5';
            } else {
              btnClasses = isNote
                ? isSelected
                  ? 'bg-amber-950/95 text-amber-205 border-b-2 border-amber-500 ring-2 ring-amber-700/85 font-semibold px-1.5 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                  : 'bg-amber-950/45 text-amber-300 border-b-2 border-dashed border-amber-700/60 hover:bg-amber-950/70 px-1 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                : isSelected
                  ? 'bg-red-950/95 text-red-100 border-b-2 border-red-500 ring-2 ring-red-700/85 font-semibold px-1.5 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                  : 'bg-red-950/45 text-red-350 border-b-2 border-dashed border-red-700/60 hover:bg-red-950/70 px-1 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5';
            }
          } else {
            if (isAccepted) {
              btnClasses = isSelected
                ? 'bg-emerald-200 text-emerald-950 border-b-2 border-emerald-650 ring-2 ring-emerald-305 font-semibold px-1.5 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                : 'bg-emerald-50 text-emerald-800 border-b border-dashed border-emerald-400 hover:bg-emerald-100/50 px-1 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5';
            } else if (isIgnored) {
              btnClasses = isSelected
                ? 'bg-zinc-200 text-zinc-950 border-b-2 border-zinc-650 ring-2 ring-zinc-305 font-semibold px-1.5 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                : 'bg-zinc-100/50 text-zinc-500 border-b border-dashed border-zinc-300 hover:bg-zinc-200/50 px-1 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5';
            } else {
              btnClasses = isNote
                ? isSelected
                  ? 'bg-amber-200 text-amber-950 border-b-2 border-amber-600 ring-2 ring-amber-305 font-semibold px-1.5 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                  : 'bg-amber-100/75 text-amber-900 border-b-2 border-dashed border-amber-405 hover:bg-amber-200/50 px-1 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                : isSelected
                  ? 'bg-red-200 text-red-950 border-b-2 border-red-650 ring-2 ring-red-305 font-semibold px-1.5 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5'
                  : 'bg-red-100/75 text-red-900 border-b-2 border-dashed border-red-405 hover:bg-red-200/50 px-1 py-0.5 rounded transition-all inline cursor-pointer font-serif text-[18px] align-baseline my-0.5';
            }
          }
          
          matchBtn.className = btnClasses;
          matchBtn.textContent = matchText;
          matchBtn.title = `Review rule: ${issue.rule}`;
          
          const postNode = doc.createTextNode(postText);
          
          if (parent) {
            parent.replaceChild(postNode, node);
            parent.insertBefore(matchBtn, postNode);
            parent.insertBefore(preNode, matchBtn);
          }
          
          walk(preNode);
          walk(postNode);
          return;
        }
      }
    } else {
      const children = Array.from(node.childNodes);
      children.forEach(walk);
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
};

// Lazy Firebase Client SDK hooks
let clientFirebaseApp: any = null;
let clientFirebaseAuth: any = null;
let clientFirebaseDb: any = null;

function getClientFirebase(config: any) {
  if (!clientFirebaseApp && config && config.apiKey) {
    try {
      clientFirebaseApp = initializeApp(config);
      clientFirebaseAuth = getAuth(clientFirebaseApp);
      clientFirebaseDb = getFirestore(clientFirebaseApp, config.databaseId || '(default)');
    } catch (e) {
      console.error("Client Firebase lazy initialization error:", e);
    }
  }
  return { 
    app: clientFirebaseApp, 
    auth: clientFirebaseAuth, 
    db: clientFirebaseDb 
  };
}

function enforceSmartQuotes(str: string): string {
  if (!str) return str;
  return str
    .replace(/`/g, "'")
    .replace(/(^|[-\u2014\s(\["])(['‘])(90s|80s|70s|60s|00s|em|burb|nduja|cause|bout|til|n)\b/gi, "$1\u2019$3")
    .replace(/(^|[-\u2014\s(\["])'/g, "$1\u2018")
    .replace(/'/g, "\u2019")
    .replace(/([a-zA-Z])‘([a-zA-Z])/g, "$1\u2019$2")
    .replace(/([a-zA-Z])‘s\b/gi, "$1\u2019s")
    .replace(/(^|[-\u2014\s(\['])"/g, "$1\u201C")
    .replace(/"/g, "\u201D");
}

function enforceSmartQuotesOnHtml(html: string): string {
  if (!html) return html;
  return html.replace(/(<[^>]*>)|([^<]+)/g, (match, tag, text) => {
    if (tag) return tag;
    return enforceSmartQuotes(text);
  });
}

export default function App() {
  const [copy, setCopy] = useState('');
  const [copyHtml, setCopyHtml] = useState('');
  const [originalCopy, setOriginalCopy] = useState('');
  const [originalCopyHtml, setOriginalCopyHtml] = useState('');
  const [currentDraft, setCurrentDraft] = useState('');
  const [currentDraftHtml, setCurrentDraftHtml] = useState('');
  const [theme, setTheme] = useState<ThemeType>('light');
  const [copyMode] = useState<'editorial'>('editorial');
  const [enableSocialMediaGuidelines, setEnableSocialMediaGuidelines] = useState(false);
  const [enableThinkingMode, setEnableThinkingMode] = useState(false);

  // Accounts & Authentication States
  const [user, setUser] = useState<any | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'sub-editor' | 'editor' | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authorizedState, setAuthorizedState] = useState<'checking' | 'unauthenticated' | 'authorized' | 'pending'>('checking');
  
  // Login Form States
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // User Directory Admin Panel States
  const [showUserDirectory, setShowUserDirectory] = useState(false);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'sub-editor' | 'editor'>('editor');
  const [userDirError, setUserDirError] = useState<string | null>(null);
  const [userDirSuccess, setUserDirSuccess] = useState<string | null>(null);
  
  const [issues, setIssues] = useState<StyleIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<'idle' | 'style' | 'consistency' | 'dictionary'>('idle');
  const [error, setError] = useState<string | null>(null);
  
  // Custom Dynamic Style Guide Manager states


  // Macquarie Dictionary States
  const [macquarieStatus, setMacquarieStatus] = useState<{ imported: boolean; wordCount: number; fileSize: number; sampleWords: string[] } | null>(null);
  const [isSyncingMacquarie, setIsSyncingMacquarie] = useState(false);
  const [macquarieInput, setMacquarieInput] = useState('');
  const [isUploadingMacquarie, setIsUploadingMacquarie] = useState(false);
  const [macquarieError, setMacquarieError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [confirmClearMacquarie, setConfirmClearMacquarie] = useState(false);
  const [showMacquarieManager, setShowMacquarieManager] = useState(false);
  const macquarieFileContentRef = useRef<string | null>(null);

  // User Feedback States
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showFeedbackHub, setShowFeedbackHub] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<'idea' | 'ux_request' | 'ai_error' | 'general'>('general');
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackDescription, setFeedbackDescription] = useState('');
  const [feedbackPriority, setFeedbackPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [attachFeedbackContext, setAttachFeedbackContext] = useState(true);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Data Privacy & AI Safeguards States
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState<any>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);

  const fetchPrivacyStatus = async () => {
    setPrivacyLoading(true);
    try {
      const authHeaders: any = {};
      if (user && user.email) {
        authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
      }
      const res = await fetch('/api/security/privacy-status', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setPrivacyStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch privacy status:', e);
    } finally {
      setPrivacyLoading(false);
    }
  };

  // Feedback Hub States
  const [feedbackList, setFeedbackList] = useState<any[]>([]);
  const [feedbackListLoading, setFeedbackListLoading] = useState(false);
  const [feedbackFilterCategory, setFeedbackFilterCategory] = useState<string>('all');
  const [feedbackFilterStatus, setFeedbackFilterStatus] = useState<string>('all');
  const [selectedFeedbackItem, setSelectedFeedbackItem] = useState<any | null>(null);

  const fetchFeedbackList = async () => {
    setFeedbackListLoading(true);
    try {
      const authHeaders: any = {};
      if (user && user.email) {
        authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
      }
      const res = await fetch('/api/feedback', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setFeedbackList(data.feedback || []);
        if (data.feedback && data.feedback.length > 0 && !selectedFeedbackItem) {
          setSelectedFeedbackItem(data.feedback[0]);
        }
      }
    } catch (err) {
      console.error('Error fetching feedback list:', err);
    } finally {
      setFeedbackListLoading(false);
    }
  };

  // Admin Usage & Activity Stats States
  const [showUsageStatsModal, setShowUsageStatsModal] = useState(false);
  const [usageStatsData, setUsageStatsData] = useState<any>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);

  const fetchUsageStats = async () => {
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const authHeaders: any = {};
      if (user && user.email) {
        authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
      }
      const res = await fetch('/api/admin/stats', { headers: authHeaders });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to fetch usage statistics');
      }
      const data = await res.json();
      setUsageStatsData(data);
    } catch (err: any) {
      console.error('Error fetching usage stats:', err);
      setUsageStatsError(err.message || 'Failed to retrieve usage statistics.');
    } finally {
      setUsageStatsLoading(false);
    }
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackTitle.trim() || !feedbackDescription.trim()) {
      setFeedbackError('Please provide both a summary title and detailed explanation.');
      return;
    }
    setFeedbackSubmitting(true);
    setFeedbackError(null);

    try {
      let contextStr = '';
      if (attachFeedbackContext) {
        const activeText = currentDraft || copy || '';
        const currentWordCount = activeText.trim() ? activeText.trim().split(/\s+/).length : 0;
        const statsSummary = `Word count: ${currentWordCount}, Active suggestions count: ${issues.length}`;
        const copySnippet = copy ? `Current Copy Snippet: "${copy.substring(0, 400)}..."` : 'No active draft copy';
        contextStr = `${statsSummary}\n${copySnippet}`;
      }

      const authHeaders: any = {};
      if (user && user.email) {
        authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
      }

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          category: feedbackCategory,
          title: feedbackTitle.trim(),
          description: feedbackDescription.trim(),
          priority: feedbackPriority,
          attachedContext: contextStr
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to submit feedback.');
      }

      setFeedbackSuccess(true);
      setFeedbackTitle('');
      setFeedbackDescription('');
      setTimeout(() => {
        setFeedbackSuccess(false);
        setShowFeedbackModal(false);
      }, 2000);
    } catch (err: any) {
      setFeedbackError(err.message || 'An error occurred while submitting feedback.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleUpdateFeedbackStatus = async (id: string, newStatus: string) => {
    try {
      const authHeaders: any = {};
      if (user && user.email) {
        authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
      }
      const res = await fetch(`/api/feedback/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setFeedbackList(prev => prev.map(item => item.id === id ? { ...item, status: newStatus } : item));
        if (selectedFeedbackItem?.id === id) {
          setSelectedFeedbackItem(prev => prev ? { ...prev, status: newStatus } : null);
        }
      }
    } catch (err) {
      console.error('Failed to update feedback status:', err);
    }
  };

  const handleDeleteFeedback = async (id: string) => {
    try {
      const authHeaders: any = {};
      if (user && user.email) {
        authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
      }
      const res = await fetch(`/api/feedback/${id}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (res.ok) {
        setFeedbackList(prev => prev.filter(item => item.id !== id));
        if (selectedFeedbackItem?.id === id) {
          setSelectedFeedbackItem(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete feedback:', err);
    }
  };


  // Refinement Report States
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [activeReportTab, setActiveReportTab] = useState<'all' | 'accepted' | 'ignored'>('all');
  const [customReportText, setCustomReportText] = useState<string | null>(null);

  // Review Logs States
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logs, setLogs] = useState<StyleReviewLog[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logReportCopied, setLogReportCopied] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);

  // Memoized historical session logs metrics
  const averageAcceptanceRate = useMemo(() => {
    if (logs.length === 0) return 0;
    const sum = logs.reduce((acc, log) => {
      const rate = log.totalSuggestions > 0 ? (log.acceptedCount / log.totalSuggestions) * 100 : 100;
      return acc + rate;
    }, 0);
    return Math.round(sum / logs.length);
  }, [logs]);

  const averageAcceptedChangesPer100Words = useMemo(() => {
    if (logs.length === 0) return 0;
    const sum = logs.reduce((acc, log) => {
      const changesPer100 = log.wordCount > 0 ? (log.acceptedCount / log.wordCount) * 100 : 0;
      return acc + changesPer100;
    }, 0);
    return sum / logs.length;
  }, [logs]);

  const logsChronological = useMemo(() => {
    return [...logs].reverse();
  }, [logs]);

  const sparklineTrendPoints = useMemo(() => {
    if (logsChronological.length <= 1) return '';
    const svgWidth = 500;
    const svgHeight = 60;
    const paddingX = 40;
    const paddingY = 12;
    return logsChronological.map((log, idx) => {
      const stepX = (svgWidth - paddingX * 2) / (logsChronological.length - 1);
      const rate = log.totalSuggestions > 0 ? (log.acceptedCount / log.totalSuggestions) * 100 : 100;
      const x = paddingX + idx * stepX;
      const y = svgHeight - paddingY - (rate / 100) * (svgHeight - paddingY * 2);
      return `${x},${y}`;
    }).join(' ');
  }, [logsChronological]);

  const [auditLogSearchQuery, setAuditLogSearchQuery] = useState<string>('');

  const auditableLogs = useMemo(() => {
    return logs.filter(l => l.originalCopyText && l.originalCopyText.trim().length > 0);
  }, [logs]);

  const filteredAuditLogs = useMemo(() => {
    if (!auditLogSearchQuery.trim()) return auditableLogs;
    const query = auditLogSearchQuery.toLowerCase();
    return auditableLogs.filter(log => {
      const logName = (log.logName || '').toLowerCase();
      const draftSummary = (log.draftSummary || '').toLowerCase();
      const timestamp = (log.timestamp || '').toLowerCase();
      const originalText = (log.originalCopyText || '').toLowerCase();
      return logName.includes(query) || draftSummary.includes(query) || timestamp.includes(query) || originalText.includes(query);
    });
  }, [auditableLogs, auditLogSearchQuery]);

  // Cross-Check States
  const [showCrossCheck, setShowCrossCheck] = useState(false);
  const [isDirectAuditFlow, setIsDirectAuditFlow] = useState(false);
  const [humanFinalizedCopy, setHumanFinalizedCopy] = useState('');
  const [crossCheckLoading, setCrossCheckLoading] = useState(false);
  const [crossCheckError, setCrossCheckError] = useState<string | null>(null);
  const [crossCheckAnalysis, setCrossCheckAnalysis] = useState<{
    accuracyScore: number;
    alignmentGap: string;
    missedInfractions: {
      original: string;
      human: string;
      ai: string;
      rule: string;
      explanation: string;
      fineTuningPatch: string;
      targetGuide: 'editorial' | 'banned' | 'dictionary' | 'mistakes';
      persisted?: boolean;
    }[];
    fineTuningActionable: string;
  } | null>(null);
  const [guidePatchesSaving, setGuidePatchesSaving] = useState<{ [key: number]: boolean }>({});
  const [guidePatchesProgress, setGuidePatchesProgress] = useState<{ [key: number]: string }>({});
  const [isDragOver, setIsDragOver] = useState(false);

  // Log naming and session audit selections
  const [customLogName, setCustomLogName] = useState<string>('');
  const [aiCorrectedText, setAiCorrectedText] = useState<string>('');
  const [selectedSessionLogForAudit, setSelectedSessionLogForAudit] = useState<StyleReviewLog | null>(null);

  // Database States
  const [dbLogs, setDbLogs] = useState<any[]>([]);
  const [dbLogsLoading, setDbLogsLoading] = useState(false);
  const [expandedDbLogId, setExpandedDbLogId] = useState<string | null>(null);
  const [showDbLogsModal, setShowDbLogsModal] = useState(false);
  const [isConfirmingClearDb, setIsConfirmingClearDb] = useState(false);
  const [deletingDbLogId, setDeletingDbLogId] = useState<string | null>(null);
  const [reEvaluatingLogId, setReEvaluatingLogId] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbSource, setDbSource] = useState<'firestore' | 'local_backup'>('firestore');
  const [dbParams, setDbParams] = useState<{ projectId: string | null; databaseId: string | null } | null>(null);
  const [isServerWaking, setIsServerWaking] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const wakeAndFetchDb = async (attempt = 1, maxAttempts = 12) => {
    setIsServerWaking(true);
    setDbError(null);
    const authHeaders: any = {};
    if (user && user.email) {
      authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
    }
    
    try {
      const response = await fetch('/api/db-status');
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) {
        throw new Error('Server returned HTML or temporary 502/503 while warming up.');
      }
      const statusData = await response.json();
 
      const logsResponse = await fetch('/api/crosscheck/logs', { headers: authHeaders });
      const logsContentType = logsResponse.headers.get('content-type') || '';
      if (!logsResponse.ok || !logsContentType.includes('application/json')) {
        throw new Error('Logs API returned non-JSON/HTML SPA response.');
      }
      const logsData = await logsResponse.json();
 
      if (logsData && Array.isArray(logsData.logs)) {
        setDbLogs(logsData.logs);
        setDbSource(logsData.status?.source || 'firestore');
        setDbError(logsData.status?.error || null);
      } else if (Array.isArray(logsData)) {
        setDbLogs(logsData);
        setDbSource(statusData.status?.source || 'firestore');
        setDbError(statusData.status?.error || null);
      }
 
      // Sync and retrieve shared session review logs
      try {
        const sessionLogsResponse = await fetch('/api/session-logs', { headers: authHeaders });
        if (sessionLogsResponse.ok && sessionLogsResponse.headers.get('content-type')?.includes('application/json')) {
          const sessionLogsData = await sessionLogsResponse.json();
          if (sessionLogsData && Array.isArray(sessionLogsData.logs)) {
            setLogs(sessionLogsData.logs);
          }
        }
      } catch (sessionErr) {
        console.warn('Could not sync shared session logs on server warm up:', sessionErr);
      }

      if (statusData.firebaseConfig) {
        setDbParams({
          projectId: statusData.firebaseConfig.projectId,
          databaseId: statusData.firebaseConfig.databaseId
        });
      }

      setIsServerWaking(false);
      setRetryCount(0);
    } catch (err: any) {
      console.warn(`Database connection attempt ${attempt}/${maxAttempts} failed:`, err);
      if (attempt < maxAttempts) {
        setRetryCount(attempt);
        setTimeout(() => {
          wakeAndFetchDb(attempt + 1, maxAttempts);
        }, 2000);
      } else {
        setIsServerWaking(false);
        setDbError(
          `Cloud database server went to sleep or is offline. Please click "Wake Server" to retry.`
        );
        setDbSource('local_backup');
        try {
          const softRes = await fetch('/api/crosscheck/logs', { headers: authHeaders });
          if (softRes.ok && softRes.headers.get('content-type')?.includes('application/json')) {
            const data = await softRes.json();
            if (data && Array.isArray(data.logs)) {
              setDbLogs(data.logs);
            }
          }
        } catch (e) {}
      }
    }
  };

  const safeFetchJson = async (url: string, options?: RequestInit): Promise<any> => {
    const finalHeaders = { ...(options?.headers as any) };
    if (user && user.email) {
      finalHeaders['X-User-Email'] = user.email.toLowerCase().trim();
    }
    const finalOptions: RequestInit = {
      ...options,
      headers: finalHeaders
    };
    const response = await fetch(url, finalOptions);
    
    // Check if response is not ok (e.g., status standard errors or SPA fallback page)
    if (!response.ok) {
      const errorText = await response.text();
      let message = `Server Error [HTTP ${response.status}: ${response.statusText}]`;
      if (errorText.trim().startsWith('<')) {
        message = `Server returned unexpected HTML (HTTP ${response.status}). This often means the API endpoint is unavailable or the backend server is booting up.`;
      } else {
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.error) message = parsed.error;
        } catch (e) {
          if (errorText.length < 200) {
            message = errorText;
          }
        }
      }
      throw new Error(message);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Received unexpected HTML instead of JSON. The backend server might still be booting up or warming up on this container.');
      }
      throw new Error(`Expected JSON but got Content-Type: "${contentType}".`);
    }

    try {
      const data = await response.json();
      return { data, response };
    } catch (err: any) {
      throw new Error(`Failed to decode JSON response: ${err?.message || err}`);
    }
  };

  const fetchDbLogs = async () => {
    setDbLogsLoading(true);
    setDbError(null);
    try {
      const { data, response } = await safeFetchJson('/api/crosscheck/logs');
      if (data && Array.isArray(data.logs)) {
        setDbLogs(data.logs);
        setDbSource(data.status?.source || 'firestore');
        setDbError(data.status?.error || null);
      } else if (Array.isArray(data)) {
        setDbLogs(data);
        const sourceHeader = response.headers.get('X-Database-Source') || 'firestore';
        const errorHeader = response.headers.get('X-Database-Error');
        setDbSource(sourceHeader as any);
        setDbError(errorHeader ? decodeURIComponent(errorHeader) : null);
      }
    } catch (err) {
      console.error('Failed to fetch cross check database logs:', err);
      setDbError(err instanceof Error ? err.message : 'Connection to server database failed.');
      setDbSource('local_backup');
    } finally {
      setDbLogsLoading(false);
    }
  };

  const fetchDbStatus = async () => {
    try {
      const { data } = await safeFetchJson('/api/db-status');
      if (data && data.status) {
        setDbSource(data.status.source || 'firestore');
        setDbError(data.status.error || null);
        if (data.firebaseConfig) {
          setDbParams({
            projectId: data.firebaseConfig.projectId,
            databaseId: data.firebaseConfig.databaseId
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch database status:', e);
    }
  };

  const handleClearDbLogs = async () => {
    if (!isConfirmingClearDb) {
      setIsConfirmingClearDb(true);
      setTimeout(() => {
        setIsConfirmingClearDb(false);
      }, 4000);
      return;
    }
    setIsConfirmingClearDb(false);
    try {
      const { data } = await safeFetchJson('/api/crosscheck/logs/clear', { method: 'POST' });
      if (data.success) {
        setDbLogs([]);
        setExpandedDbLogId(null);
      }
    } catch (err) {
      console.error('Failed to clear logs database:', err);
    }
  };

  const handleDeleteDbLog = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingDbLogId !== id) {
      setDeletingDbLogId(id);
      setTimeout(() => {
        setDeletingDbLogId(null);
      }, 4000);
      return;
    }
    setDeletingDbLogId(null);
    try {
      const { data } = await safeFetchJson(`/api/crosscheck/logs/${id}`, { method: 'DELETE' });
      if (data.success) {
        setDbLogs(prev => prev.filter(log => log.id !== id));
        if (expandedDbLogId === id) setExpandedDbLogId(null);
      }
    } catch (err) {
      console.error('Failed to delete log entry:', err);
    }
  };

  const handleReEvaluateLog = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (reEvaluatingLogId) return;
    setReEvaluatingLogId(id);
    try {
      const { data } = await safeFetchJson(`/api/crosscheck/re-evaluate/${id}`, {
        method: 'POST'
      });
      await fetchDbLogs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to re-evaluate log retroactively.');
    } finally {
      setReEvaluatingLogId(null);
    }
  };

  const downloadDbLogsJson = () => {
    if (dbLogs.length === 0) return;
    const blob = new Blob([JSON.stringify(dbLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `broadsheet_crosscheck_training_corpus_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadComplianceLogsJson = () => {
    if (logs.length === 0) return;

    // Calculate historical overall average
    const totalRates = logs.reduce((sum, log) => {
      const rate = log.totalSuggestions > 0 ? (log.acceptedCount / log.totalSuggestions) * 100 : 100;
      return sum + rate;
    }, 0);
    const averageAcceptanceRate = Math.round(totalRates / logs.length);

    const totalChangesPer100 = logs.reduce((sum, log) => {
      const rate = log.wordCount > 0 ? (log.acceptedCount / log.wordCount) * 100 : 0;
      return sum + rate;
    }, 0);
    const avgAcceptedPer100Words = Number((totalChangesPer100 / logs.length).toFixed(2));

    const enrichedLogs = logs.map(log => ({
      ...log,
      individualAcceptanceRatePercent: log.totalSuggestions > 0 ? Math.round((log.acceptedCount / log.totalSuggestions) * 100) : 100,
      individualAcceptedChangesPer100Words: log.wordCount > 0 ? Number(((log.acceptedCount / log.wordCount) * 100).toFixed(2)) : 0
    }));

    const exportPayload = {
      meta: {
        exportTimestamp: new Date().toISOString(),
        totalSessionsLogged: logs.length,
        overallAverageAcceptanceRatePercent: averageAcceptanceRate,
        overallAverageAcceptedChangesPer100Words: avgAcceptedPer100Words
      },
      sessions: enrichedLogs
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `broadsheet_compliance_history_report_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // File system interactions
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      readAndSetHumanFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readAndSetHumanFile(file);
    }
  };

  const readAndSetHumanFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setHumanFinalizedCopy(text);
      }
    };
    reader.readAsText(file);
  };

  const handleRunCrossCheck = async () => {
    if (!humanFinalizedCopy.trim()) {
      alert("Please upload or paste your finalized work first.");
      return;
    }
    setCrossCheckLoading(true);
    setCrossCheckError(null);
    try {
      const { data } = await safeFetchJson('/api/crosscheck', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalCopy,
          aiCorrected: currentDraft,
          humanFinalized: humanFinalizedCopy,
          aiSuggestions: issues
        })
      });
      if (data.error) {
        throw new Error(data.error);
      }
      setCrossCheckAnalysis(data);
      fetchDbLogs(); // Refresh database list
    } catch (err) {
      setCrossCheckError(err instanceof Error ? err.message : 'Failed to generate cross-check report.');
    } finally {
      setCrossCheckLoading(false);
    }
  };

  const renderSubEditorAuditPanel = () => {
    return (
      <div className="w-full max-w-4xl flex flex-col gap-6 animate-fadeIn pb-16">
        
        {/* Analysis Results Display */}
        {crossCheckAnalysis ? (
          <div className="flex flex-col gap-6">
            
            {/* Score and Gap Overview Block */}
            <div className={`p-6 rounded-xl border grid grid-cols-1 md:grid-cols-12 gap-6 items-center ${
              theme === 'dark' ? 'bg-gradient-to-r from-zinc-900 to-[#121215] border-zinc-800 text-zinc-100' : 'bg-gradient-to-r from-zinc-50 to-white border-zinc-200 text-zinc-900 shadow-sm'
            }`}>
              {/* Dial Column */}
              <div className="col-span-1 md:col-span-4 flex flex-col items-center justify-center text-center py-2 border-r border-zinc-800/10 dark:border-zinc-800 md:pr-6">
                <span className="text-[10px] uppercase font-bold text-zinc-400 mb-2">Editor Alignment Score</span>
                <div className="relative flex items-center justify-center">
                  <svg className="w-28 h-28 transform -rotate-90">
                    <circle cx="56" cy="56" r="46" stroke={theme === 'dark' ? '#18181c' : '#f4f4f5'} strokeWidth="8" fill="transparent" />
                    <circle cx="56" cy="56" r="46" stroke="#0055ff" strokeWidth="8" fill="transparent"
                            strokeDasharray={2 * Math.PI * 46}
                            strokeDashoffset={2 * Math.PI * 46 * (1 - crossCheckAnalysis.accuracyScore / 100)}
                            strokeLinecap="round"
                            className="transition-all duration-1000 ease-out" />
                  </svg>
                  <span className="absolute text-3xl font-black tracking-tighter">
                    {crossCheckAnalysis.accuracyScore}%
                  </span>
                </div>
                <span className="text-[9px] font-mono uppercase bg-blue-605/10 text-blue-500 font-bold px-2 py-0.5 rounded-full mt-3">
                  {crossCheckAnalysis.accuracyScore >= 90 ? 'Gold Standard' : crossCheckAnalysis.accuracyScore >= 75 ? 'Strong Alignment' : 'Needs Fine-Tuning'}
                </span>
              </div>

              {/* Evaluation Statement Column */}
              <div className="col-span-1 md:col-span-8 space-y-3">
                <span className="text-[10px] uppercase font-bold text-zinc-400 font-mono block">Accuracy Gap Assessment</span>
                <h4 className="text-xl font-bold tracking-tight m-0 normal-case leading-snug">
                  {crossCheckAnalysis.alignmentGap}
                </h4>
                <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-650'}`}>
                  {crossCheckAnalysis.fineTuningActionable}
                </p>
                <div className="flex gap-2.5 pt-1">
                  <button
                    onClick={() => { setCrossCheckAnalysis(null); }}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase border rounded-lg transition-all cursor-pointer ${
                      theme === 'dark' ? 'border-zinc-750 bg-zinc-900 hover:bg-zinc-800 text-zinc-300' : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    Re-run Analysis
                  </button>
                  <button
                    onClick={() => {
                      const text = `# AI ERROR GAP REPORT\n\n- Alignment Score: ${crossCheckAnalysis.accuracyScore}%\n- Summary: ${crossCheckAnalysis.alignmentGap}\n\n## Missed Infractions:\n` + 
                        crossCheckAnalysis.missedInfractions.map((i, index) => 
                          `### [Gap #${index + 1}] Rule: ${i.rule}\n- Original: "${i.original}"\n- Human corrected: "${i.human}"\n- AI draft: "${i.ai}"\n- Explanation: ${i.explanation}\n- Patch recommended: ${i.fineTuningPatch} (Target register: ${i.targetGuide})\n`
                        ).join('\n');
                      navigator.clipboard.writeText(text);
                      alert("Gap Report copied to clipboard as Markdown!");
                    }}
                    className="px-3 py-1.5 text-[10px] font-bold uppercase bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-lg transition-all cursor-pointer"
                  >
                    Export Gap Report
                  </button>
                </div>
              </div>
            </div>

            {/* Gaps detected list */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold tracking-[0.1em] uppercase m-0 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-500" /> Missed Style Violations & Typo Gaps ({crossCheckAnalysis.missedInfractions.length})
              </h3>

              {crossCheckAnalysis.missedInfractions.length === 0 ? (
                <div className={`p-8 text-center rounded-xl border border-dashed text-xs uppercase tracking-wider ${
                  theme === 'dark' ? 'bg-[#18181f]/30 border-zinc-800 text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                }`}>
                  Complete alignment! The AI copy-editor caught 100% of the style guide corrections that you did. No missing infractions found.
                </div>
              ) : (
                crossCheckAnalysis.missedInfractions.map((item, idx) => {
                  const pathColor = item.targetGuide === 'dictionary' ? 'text-amber-400 border-amber-500/25 bg-amber-500/5' :
                                    item.targetGuide === 'banned' ? 'text-red-400 border-red-500/25 bg-red-500/5' :
                                    item.targetGuide === 'mistakes' ? 'text-purple-400 border-purple-500/25 bg-purple-500/5' :
                                    'text-blue-400 border-blue-500/25 bg-blue-500/5';

                  return (
                    <div key={idx} className={`p-5 rounded-xl border flex flex-col gap-4 relative transition-all ${
                      theme === 'dark' ? 'bg-[#141417] border-zinc-800' : 'bg-white border-zinc-200 shadow-sm'
                    }`}>
                      {/* Header info */}
                      <div className="flex justify-between items-center pb-2 border-b border-zinc-250/10">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-amber-600 text-white rounded text-[8px] font-mono font-bold uppercase">MISS # {idx + 1}</span>
                          <span className="text-[10px] font-mono font-bold text-zinc-400">{item.rule}</span>
                        </div>
                        <span className={`px-2 py-0.5 border text-[9px] font-mono font-bold uppercase rounded ${pathColor}`}>
                          register: {item.targetGuide}
                        </span>
                      </div>

                      {/* Compares box */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
                        <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                          theme === 'dark' ? 'bg-[#0e0e11] border-zinc-800' : 'bg-zinc-50/60 border-zinc-100'
                        }`}>
                          <span className="text-[9px] font-bold text-zinc-400 uppercase">Original Copy:</span>
                          <span className="font-serif italic text-[14px] line-through decoration-red-500/50">"{item.original}"</span>
                        </div>
                        <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                          theme === 'dark' ? 'bg-[#0e0e11] border-zinc-800' : 'bg-zinc-50/65 border-zinc-100'
                        }`}>
                          <span className="text-[9px] font-bold text-zinc-500 uppercase">AI Copy Draft:</span>
                          <span className="font-serif italic text-[14px] text-zinc-400">"{item.ai || '(Unchanged)'}"</span>
                        </div>
                        <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                          theme === 'dark' ? 'bg-emerald-950/10 border-emerald-900/40' : 'bg-emerald-50/40 border-emerald-100'
                        }`}>
                          <span className="text-[9px] font-bold text-emerald-500 uppercase">Human Finalized:</span>
                          <span className="font-serif font-black text-[14px] text-emerald-600 dark:text-emerald-400">"{item.human}"</span>
                        </div>
                      </div>

                      {/* Detailed explanation */}
                      <div className="text-xs leading-relaxed">
                        <span className="font-bold block text-zinc-400 font-mono text-[9px] uppercase mb-1">Gap Analysis:</span>
                        <p className={theme === 'dark' ? 'text-zinc-300 italic font-serif' : 'text-zinc-700 italic font-serif'}>
                          {item.explanation}
                        </p>
                      </div>

                      {/* Actionable fine-tuning patch box */}
                      <div className={`p-4 rounded-lg border ${
                        theme === 'dark' ? 'bg-[#0f0f12] border-zinc-850' : 'bg-zinc-50 border-zinc-200/85'
                      }`}>
                        <div className="space-y-1.5">
                          <span className="text-[9px] uppercase font-bold text-blue-500 font-mono block">Recommended Fine-Tuning Register Patch</span>
                          <code className="text-xs font-mono font-medium bg-[#070709] text-zinc-300 dark:text-zinc-200 p-2.5 rounded block w-full break-words whitespace-pre-wrap border border-zinc-800/40 select-all leading-relaxed">
                            {item.fineTuningPatch}
                          </code>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* Paste and Analyze Workspace */
          <div className="flex flex-col gap-6">

            {/* 1. Log Selector Section */}
            <div className={`p-5 rounded-xl border flex flex-col gap-3 ${
              theme === 'dark' ? 'bg-[#141417] border-zinc-800' : 'bg-white border-zinc-200 shadow-sm'
            }`}>
              <span className="text-[10px] uppercase font-bold text-zinc-400 font-mono flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-blue-500 animate-pulse shrink-0" />
                SELECT SHARED SESSION LOG TO AUDIT (TESTING & SUB-EDITOR AUDIT)
              </span>
              <p className="text-[11px] text-zinc-500 leading-normal m-0 font-medium">
                Choose a saved compliance reviewed session log from the database. This automatically populates the original draft copy, the AI's standard suggested corrections, and your finalized manually sub-edited copy!
              </p>

              {auditableLogs.length === 0 ? (
                <div className={`mt-2 p-4 rounded-lg border border-dashed text-xs text-center flex flex-col items-center justify-center gap-1.5 ${
                  theme === 'dark' ? 'bg-zinc-900/30 border-zinc-800 text-zinc-400' : 'bg-zinc-50 border-zinc-205 text-zinc-550'
                }`}>
                  <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                  <span className="font-bold uppercase tracking-wider text-[10px]">No past review sessions found</span>
                  <p className="m-0 text-[11px] leading-relaxed max-w-md">
                    You haven't run any compliance style checks yet in this session. Run a <strong className="text-blue-500">"New Style Check"</strong> first, and that workspace will immediately be logged here for human comparison evaluation!
                  </p>
                </div>
              ) : (
                <>
                  {/* Real-time search filter query */}
                  <div className="flex flex-col sm:flex-row gap-2 mt-1">
                    <div className="relative flex-grow">
                      <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-400" />
                      <input
                        type="text"
                        value={auditLogSearchQuery}
                        onChange={(e) => setAuditLogSearchQuery(e.target.value)}
                        placeholder="Search saved logs by title, draft keyword, or date..."
                        className={`w-full pl-9 pr-3 py-2 rounded-lg text-xs font-semibold border focus:outline-none transition-all ${
                          theme === 'dark'
                            ? 'bg-[#121214] border-zinc-800 text-zinc-200 focus:border-blue-800'
                            : 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:focus:border-blue-300'
                        }`}
                      />
                    </div>
                    {auditLogSearchQuery && (
                      <button
                        onClick={() => setAuditLogSearchQuery('')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold uppercase transition-all border cursor-pointer shrink-0 ${
                          theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400' : 'border-zinc-200 hover:bg-zinc-50 text-zinc-650'
                        }`}
                      >
                        Clear Filter
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 mt-1">
                    <select
                      value={selectedSessionLogForAudit?.id || ''}
                      onChange={(e) => {
                        const matchedLog = logs.find(l => l.id === e.target.value);
                        if (matchedLog) {
                          setSelectedSessionLogForAudit(matchedLog);
                          const cleanedOrig = cleanParagraphs(matchedLog.originalCopyText || '');
                          const cleanedCorr = cleanParagraphs(matchedLog.aiCorrectedText || matchedLog.originalCopyText || '');
                          setOriginalCopy(cleanedOrig);
                          setOriginalCopyHtml(generateParagraphHtml(cleanedOrig));
                          setCurrentDraft(cleanedCorr);
                          setCurrentDraftHtml(generateParagraphHtml(cleanedCorr));
                          setHumanFinalizedCopy(cleanParagraphs(matchedLog.currentDraftText || matchedLog.originalCopyText || ''));
                        } else {
                          setSelectedSessionLogForAudit(null);
                        }
                      }}
                      className={`flex-grow px-3 py-2 rounded-lg text-xs font-semibold border focus:outline-none transition-all ${
                        theme === 'dark'
                          ? 'bg-[#121214] border-zinc-800 text-zinc-200 focus:border-blue-800'
                          : 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:border-blue-300'
                      }`}
                    >
                      <option value="">
                        {filteredAuditLogs.length === 0 
                          ? '-- No matching logs found --' 
                          : `-- Choose a shared log to audit (${filteredAuditLogs.length} matching) --`
                        }
                      </option>
                      {filteredAuditLogs.map((log) => (
                        <option key={log.id} value={log.id}>
                          {log.logName || `Draft Review - ${log.timestamp}`} (Words: {log.wordCount})
                        </option>
                      ))}
                    </select>
                    {selectedSessionLogForAudit && (
                      <button
                        onClick={() => {
                          setSelectedSessionLogForAudit(null);
                          setHumanFinalizedCopy('');
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-bold uppercase transition-all border cursor-pointer shrink-0 ${
                          theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400' : 'border-zinc-200 hover:bg-zinc-50 text-zinc-650'
                        }`}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </>
              )}
              
              {selectedSessionLogForAudit && (
                <div className={`mt-2 p-3.5 rounded-lg text-xs space-y-2.5 border leading-relaxed ${
                  theme === 'dark' ? 'bg-[#0f0f12] border-zinc-850' : 'bg-zinc-50/50 border-zinc-200'
                }`}>
                  <div className="flex justify-between text-[9px] font-mono uppercase text-zinc-500 border-b pb-1.5 dark:border-zinc-800/40">
                    <span>Selected Auditing Log: <strong className="text-blue-500">{selectedSessionLogForAudit.logName || 'Unnamed'}</strong></span>
                    <span>Time: {selectedSessionLogForAudit.timestamp}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                    <div className="space-y-1">
                      <span className="font-bold text-zinc-400 uppercase text-[9px] block">1. Original Story Text:</span>
                      <div className="line-clamp-3 italic text-zinc-500 leading-snug">"{selectedSessionLogForAudit.originalCopyText}"</div>
                    </div>
                    <div className="space-y-1">
                      <span className="font-bold text-blue-500 uppercase text-[9px] block">2. Standard AI Suggestion:</span>
                      <div className="line-clamp-3 italic text-zinc-500 leading-snug">"{selectedSessionLogForAudit.aiCorrectedText || '(Baseline)'}"</div>
                    </div>
                    <div className="space-y-1">
                      <span className="font-bold text-emerald-500 uppercase text-[9px] block">3. Final Human Sub-Edit:</span>
                      <div className="line-clamp-3 font-semibold text-zinc-300 dark:text-zinc-600 leading-snug">"{selectedSessionLogForAudit.currentDraftText || '(Same as original)'}"</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Comparing Target / Writing Canvas Form */}
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400 font-mono flex items-center justify-between">
                <span>Human Finalized Masterpiece & Sub-edited Copy (Target to Audit)</span>
                {selectedSessionLogForAudit && (
                  <span className="text-[9px] px-2 py-0.5 bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold uppercase rounded-full">
                    Populated Automatically from Session
                  </span>
                )}
              </span>
              <textarea
                value={humanFinalizedCopy}
                onChange={(e) => { setHumanFinalizedCopy(e.target.value); }}
                placeholder="Paste your copy here to compare with the AI..."
                className={`w-full p-6 min-h-[250px] rounded-xl font-serif text-[16px] leading-relaxed focus:outline-none focus:ring-1 border resize-y ${
                  theme === 'dark'
                    ? 'bg-[#121214] border-zinc-800 text-zinc-250 focus:ring-blue-800/40 focus:border-blue-800/40'
                    : 'bg-white border-zinc-200 text-zinc-900 focus:ring-blue-105/30 focus:border-blue-105/30'
                }`}
              />
            </div>

            {/* Trigger Analysis Button */}
            <div className="flex justify-end pt-2">
              <button
                onClick={handleRunCrossCheck}
                disabled={crossCheckLoading || !humanFinalizedCopy.trim()}
                className={`w-full md:w-auto px-6 py-3 rounded-lg border text-xs font-black uppercase tracking-[0.15em] cursor-pointer flex items-center justify-center gap-2 transition-all shadow-sm ${
                  theme === 'dark'
                    ? 'border-blue-800 bg-gradient-to-r from-blue-700 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-500 disabled:bg-zinc-900'
                    : 'border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-850 disabled:bg-zinc-100'
                } ${
                  crossCheckLoading || !humanFinalizedCopy.trim()
                    ? 'opacity-40 cursor-not-allowed text-zinc-500'
                    : 'active:translate-y-0.5 hover:shadow-md'
                }`}
              >
                {crossCheckLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    Computing Gap Insights...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                    Log Final Subbed Version
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {crossCheckError && (
          <div className={`p-5 rounded-md border flex items-start gap-3 shadow-inner ${
            theme === 'dark' ? 'bg-red-950/20 border-red-900/40 text-red-200' : 'bg-red-50 border-red-200 text-red-950'
          }`}>
            <AlertCircle className="w-5 h-5 shrink-0 text-red-650 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold block uppercase tracking-wide text-xs">Cross Check Failed</span>
              <p className="font-medium text-xs leading-relaxed">{crossCheckError}</p>
            </div>
          </div>
        )}

        {/* COMPLIANCE DISCREPANCY DATABASE LOGS */}
        <div className={`mt-6 p-6 rounded-xl border flex flex-col gap-6 ${
          theme === 'dark' ? 'bg-[#121214] border-zinc-800' : 'bg-white border-zinc-200 shadow-sm'
        }`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4 border-zinc-200/40 dark:border-zinc-800/60">
            <div className="flex items-center gap-2.5">
              <Database className="w-5 h-5 text-blue-500 animate-pulse shrink-0" />
              <div className="flex flex-col min-w-0">
                <h3 className="text-sm font-bold uppercase tracking-wider font-sans m-0 text-zinc-800 dark:text-zinc-150">
                  Audit Discrepancy Database
                </h3>
                <p className="text-[9px] uppercase font-semibold text-zinc-500 tracking-wider truncate">
                  Persistent audit trail of human-corrected style deviations for AI fine-tuning
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={downloadDbLogsJson}
                disabled={dbLogs.length === 0}
                className={`px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider font-bold flex items-center gap-1.5 border transition-all ${
                  dbLogs.length === 0
                    ? 'opacity-40 cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800'
                    : theme === 'dark'
                      ? 'bg-blue-950/20 border-blue-900/60 text-blue-400 hover:bg-blue-900 hover:text-white cursor-pointer'
                      : 'bg-blue-50 border-blue-100 text-blue-750 hover:bg-blue-600 hover:text-white cursor-pointer'
                }`}
                title={dbLogs.length === 0 ? "No corpus logs to download yet" : "Export database feedback as JSON standard corpus for fine-tuning"}
              >
                <Download className="w-3.5 h-3.5" />
                Download Corpus ({dbLogs.length})
              </button>
              
              {dbLogs.length > 0 && (
                <button
                  onClick={handleClearDbLogs}
                  className={`px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
                    isConfirmingClearDb
                      ? 'bg-red-600 border-red-650 text-white animate-pulse'
                      : theme === 'dark'
                        ? 'bg-red-950/10 border-red-900/30 text-red-450 hover:bg-red-800 hover:text-white'
                        : 'bg-red-50 border-red-100 text-red-650 hover:bg-red-600 hover:text-white'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isConfirmingClearDb ? "Confirm Delete?" : "Clear Logs"}
                </button>
              )}
            </div>
          </div>

          {dbLogsLoading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-500 text-xs font-mono uppercase">
              <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
              Syncing database records...
            </div>
          ) : dbLogs.length === 0 ? (
            <div className="py-8 text-center text-zinc-500 text-xs font-mono uppercase border border-dashed border-zinc-200/50 dark:border-zinc-850 rounded-lg">
              No logs recorded in the database yet. Run a discrepancy analysis to start logging style gaps.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
                <div className={`p-4 rounded-lg border ${
                  theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-800' : 'bg-zinc-50/50 border-zinc-200'
                }`}>
                  <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Total Logs</span>
                  <span className="text-xl font-black text-zinc-850 dark:text-zinc-200">{dbLogs.length}</span>
                </div>
                <div className={`p-4 rounded-lg border ${
                  theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-800' : 'bg-zinc-50/50 border-zinc-200'
                }`}>
                  <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Avg Accuracy Score</span>
                  <span className="text-xl font-black text-blue-600 dark:text-blue-450">
                    {Math.round(dbLogs.reduce((acc, log) => acc + (log.accuracyScore || 0), 0) / dbLogs.length)}%
                  </span>
                </div>
                <div className={`p-4 rounded-lg border ${
                  theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-800' : 'bg-zinc-50/50 border-zinc-200'
                }`}>
                  <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Resolved Style Gaps</span>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                    {dbLogs.reduce((acc, log) => acc + (log.missedInfractions?.length || 0), 0)}
                  </span>
                </div>
                <div className={`p-4 rounded-lg border ${
                  theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-800' : 'bg-zinc-50/50 border-zinc-200'
                }`}>
                  <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Alignments Met</span>
                  <span className="text-xl font-black text-amber-600 dark:text-amber-400">
                    {dbLogs.reduce((acc, log) => acc + (log.correctAdherences?.length || 0), 0)}
                  </span>
                </div>
              </div>

              {/* Logs List */}
              <div className="flex flex-col gap-3 max-h-[450px] overflow-y-auto pr-1">
                {dbLogs.map((log) => {
                  const isExpanded = expandedDbLogId === log.id;
                  let dateStr = log.timestamp;
                  let timeStr = '';
                  const d = new Date(log.timestamp);
                  if (!isNaN(d.getTime())) {
                    dateStr = d.toLocaleDateString('en-AU');
                    timeStr = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
                  }
                  
                  let evaluatedStr = '';
                  if (log.lastEvaluatedAt) {
                    const eD = new Date(log.lastEvaluatedAt);
                    if (!isNaN(eD.getTime())) {
                      evaluatedStr = ` • Evaluated: ${eD.toLocaleDateString('en-AU')} @ ${eD.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
                    }
                  }
                  
                  // Color code scores
                  const scoreColor = 'text-blue-500 border-blue-500/20 bg-blue-500/10';

                  return (
                    <div 
                      key={log.id}
                      className={`rounded-lg border transition-all ${
                        theme === 'dark'
                          ? 'border-zinc-800/80 bg-[#17171a]/50 hover:bg-[#17171a]'
                          : 'border-zinc-200 bg-zinc-50/20 hover:bg-zinc-50'
                      }`}
                    >
                      {/* Entry Header */}
                      <div 
                        onClick={() => setExpandedDbLogId(isExpanded ? null : log.id)}
                        className="p-4 flex items-center justify-between gap-4 cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`text-xs font-mono font-black border px-2 py-0.5 rounded shrink-0 ${scoreColor}`}>
                            {log.accuracyScore}%
                          </span>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">
                              {log.alignmentGap ? log.alignmentGap : 'No prominent copy editorial gaps found.'}
                            </span>
                            <span className="text-[9px] font-mono text-zinc-500 uppercase mt-0.5">
                              {dateStr} @ {timeStr} • {log.missedInfractions?.length || 0} gaps logged • {log.correctAdherences?.length || 0} correct{evaluatedStr}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={(e) => handleReEvaluateLog(log.id, e)}
                            disabled={reEvaluatingLogId !== null}
                            className={`p-1.5 transition-colors rounded cursor-pointer ${
                              reEvaluatingLogId === log.id
                                ? 'text-emerald-500 bg-emerald-500/10'
                                : 'text-zinc-500 hover:text-emerald-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                            title="Retroactively Re-evaluate Alignment & calculate correct alignments"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${reEvaluatingLogId === log.id ? 'animate-spin text-emerald-500' : ''}`} />
                          </button>

                          <button 
                            onClick={(e) => handleDeleteDbLog(log.id, e)}
                            className={`p-1.5 transition-colors rounded cursor-pointer ${
                              deletingDbLogId === log.id 
                                ? 'text-white bg-red-650 font-bold px-2 py-0.5 text-[9px] rounded animate-pulse' 
                                : 'text-zinc-500 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                            title={deletingDbLogId === log.id ? "Click again to confirm delete" : "Delete entry"}
                          >
                            {deletingDbLogId === log.id ? (
                              "DELETE?"
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <span className="text-zinc-400">
                            {isExpanded ? (
                              <ChevronRight className="w-4 h-4 rotate-270 transform transition-transform" />
                            ) : (
                              <ChevronRight className="w-4 h-4 rotate-90 transform transition-transform" />
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Expanded Body */}
                      {isExpanded && (
                        <div className="p-4 pt-0 border-t border-zinc-200/20 dark:border-zinc-800/60 flex flex-col gap-4 animate-fadeIn">
                          {/* Texts Preview */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-xs leading-relaxed font-serif">
                            <div className={`p-3 rounded border flex flex-col gap-1 ${
                              theme === 'dark' ? 'bg-[#0f0f12] border-zinc-800' : 'bg-white border-zinc-200'
                            }`}>
                              <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase">Original draft snippet:</span>
                              <p className="text-zinc-450 dark:text-zinc-400 italic line-clamp-3">"{log.originalCopy}"</p>
                            </div>
                            <div className={`p-3 rounded border flex flex-col gap-1 ${
                              theme === 'dark' ? 'bg-[#0f0f12] border-zinc-800' : 'bg-white border-zinc-200'
                            }`}>
                              <span className="text-[9px] font-mono font-bold text-blue-500 uppercase">Human masterpiece snippet:</span>
                              <p className="text-zinc-800 dark:text-zinc-200 font-bold line-clamp-3">"{log.humanFinalized}"</p>
                            </div>
                          </div>

                          {/* Actionable summary */}
                          {log.fineTuningActionable && (
                            <div className="text-xs">
                              <span className="text-[9px] uppercase font-bold text-zinc-500 font-mono">Fine-Tuning Recommendation:</span>
                              <p className="text-zinc-700 dark:text-zinc-300 italic font-serif mt-1">{log.fineTuningActionable}</p>
                            </div>
                          )}

                          {/* Missed Infractions List */}
                          {log.missedInfractions && log.missedInfractions.length > 0 && (
                            <div className="flex flex-col gap-2.5">
                              <span className="text-[9px] font-mono uppercase font-semibold text-zinc-500">Logged Infraction Details ({log.missedInfractions.length})</span>
                              <div className="flex flex-col gap-2">
                                {log.missedInfractions.map((inf: any, infIdx: number) => (
                                  <div 
                                    key={infIdx}
                                    className={`p-3 rounded border text-xs flex flex-col gap-2 ${
                                      theme === 'dark' ? 'bg-[#18181c]/40 border-zinc-800/60' : 'bg-zinc-150/10 border-zinc-200/50'
                                    }`}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-[9px] font-mono font-bold uppercase py-0.5 px-1.5 bg-blue-500/10 text-blue-550 dark:text-blue-400 rounded border border-blue-500/20">
                                        {inf.rule}
                                      </span>
                                      <span className="text-[9px] font-mono text-zinc-500 uppercase">
                                        Register: {inf.targetGuide || 'editorial'}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[9px] mt-1 text-zinc-500">
                                      <div>AI missed: <span className="text-red-500 line-through">"{inf.original}"</span></div>
                                      <div>Human: <span className="text-emerald-600 dark:text-emerald-400 font-bold">"{inf.human}"</span></div>
                                      <div>AI got: <span className="text-zinc-450 font-bold">"{inf.ai || '(No correction)'}"</span></div>
                                    </div>
                                    <div className="text-xs italic text-zinc-650 dark:text-zinc-400 mt-1 font-serif">
                                      {inf.explanation}
                                    </div>
                                    <div className="space-y-0.5 mt-1 border-t pt-1.5 border-zinc-200/50 dark:border-zinc-800/65">
                                      <span className="text-[8px] tracking-wide uppercase text-blue-500 block">Fine-Tuning Register Patch:</span>
                                      <code className="text-[10px] font-mono block bg-[#0c0c0e] text-zinc-300 dark:text-zinc-200 p-2 rounded font-medium select-all border border-zinc-800/35">
                                        {inf.fineTuningPatch}
                                      </code>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Correct Adherences List */}
                          {log.correctAdherences && log.correctAdherences.length > 0 && (
                            <div className="flex flex-col gap-2.5 mt-2 pt-2 border-t border-zinc-200/40 dark:border-zinc-800/60">
                              <span className="text-[9px] font-mono uppercase font-semibold text-emerald-500">Correct Alignments ({log.correctAdherences.length})</span>
                              <div className="flex flex-col gap-2">
                                {log.correctAdherences.map((adh: any, adhIdx: number) => (
                                  <div 
                                    key={adhIdx}
                                    className={`p-3 rounded border text-xs flex flex-col gap-2 ${
                                      theme === 'dark' ? 'bg-[#18181c]/40 border-zinc-800/60' : 'bg-emerald-50/10 border-emerald-200/30'
                                    }`}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-[9px] font-mono font-bold uppercase py-0.5 px-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded border border-emerald-500/20">
                                        {adh.rule}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[9px] mt-1 text-zinc-500">
                                      <div>Original copy: <span className="text-zinc-450">"{adh.original}"</span></div>
                                      <div>Aligned styling: <span className="text-emerald-600 dark:text-emerald-400 font-bold">"{adh.corrected}"</span></div>
                                    </div>
                                    <div className="text-xs italic text-zinc-650 dark:text-zinc-400 mt-1 font-serif">
                                      {adh.explanation}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleApplyFineTuningPatch = async (index: number) => {
    if (!crossCheckAnalysis) return;
    const item = crossCheckAnalysis.missedInfractions[index];
    if (item.persisted) return;

    setGuidePatchesSaving(prev => ({ ...prev, [index]: true }));
    setGuidePatchesProgress(prev => ({ ...prev, [index]: 'Applying...' }));

    try {
      // 1. Fetch current guidelines
      const { data: guidesData } = await safeFetchJson('/api/documents');
      const currentContent = guidesData[item.targetGuide] || '';

      // 2. Append patch
      if (currentContent.includes(item.fineTuningPatch)) {
        setGuidePatchesProgress(prev => ({ ...prev, [index]: 'Rule already exists!' }));
        setCrossCheckAnalysis(prev => {
          if (!prev) return prev;
          const updated = [...prev.missedInfractions];
          updated[index] = { ...updated[index], persisted: true };
          return { ...prev, missedInfractions: updated };
        });
        return;
      }

      const appendedContent = currentContent.trim() + '\n\n' + item.fineTuningPatch;

      // 3. Save it back
      const { data: saveResult } = await safeFetchJson('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType: item.targetGuide,
          content: appendedContent
        })
      });
      if (saveResult.success) {
        setGuidePatchesProgress(prev => ({ ...prev, [index]: 'Successfully Appended!' }));
        setCrossCheckAnalysis(prev => {
          if (!prev) return prev;
          const updated = [...prev.missedInfractions];
          updated[index] = { ...updated[index], persisted: true };
          return { ...prev, missedInfractions: updated };
        });
      } else {
        throw new Error(saveResult.error || 'Failed to update style guide.');
      }
    } catch (err) {
      console.error(err);
      setGuidePatchesProgress(prev => ({ ...prev, [index]: 'Error applying patch.' }));
    } finally {
      setGuidePatchesSaving(prev => ({ ...prev, [index]: false }));
    }
  };

  // Initialize customReportText when the report modal is opened
  useEffect(() => {
    if (showReportModal) {
      setCustomReportText(generateReportText());
    } else {
      setCustomReportText(null);
    }
  }, [showReportModal]);

  // Load cross-check DB logs when entering Cross-Check
  useEffect(() => {
    if (showCrossCheck) {
      fetchDbLogs();
    }
  }, [showCrossCheck]);

  // Load database logs when modal opens
  useEffect(() => {
    if (showDbLogsModal) {
      fetchDbLogs();
    }
  }, [showDbLogsModal]);

  // Authentication Lifecycle & State Synchronization
  useEffect(() => {
    async function initAuth() {
      try {
        const savedLocalUser = localStorage.getItem('local_auth_user');
        if (savedLocalUser) {
          try {
            const parsed = JSON.parse(savedLocalUser);
            if (parsed && parsed.email) {
              const cleanEmail = parsed.email.toLowerCase().trim();
              setUser({ email: cleanEmail, isLocal: true });
              setAuthorizedState('checking');
              
              const resMe = await fetch('/api/auth/me', {
                headers: {
                  'X-User-Email': cleanEmail
                }
              });
              
              if (resMe.ok) {
                const meData = await resMe.json();
                setUserRole(meData.role);
                setAuthorizedState('authorized');
                return;
              } else {
                const meData = await resMe.json();
                if (meData && meData.status === 'pending') {
                  setUserRole(null);
                  setAuthorizedState('pending');
                  return;
                } else {
                  localStorage.removeItem('local_auth_user');
                  setUser(null);
                  setUserRole(null);
                  setAuthorizedState('unauthenticated');
                }
              }
            }
          } catch (e) {
            console.error("Local auth storage restore check error:", e);
          }
        }
        setAuthorizedState('unauthenticated');
      } catch (err: any) {
        console.error("Local auth initialization failed:", err);
        setAuthorizedState('unauthenticated');
      }
    }
    
    initAuth();
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    
    try {
      const cleanEmail = loginEmail.toLowerCase().trim();
      const endpoint = isSignUp ? '/api/auth/register' : '/api/auth/login';
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: cleanEmail, password: loginPassword })
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "An authentication error occurred.");
      }
      
      const authResult = await response.json();
      const localUser = { email: authResult.email, isLocal: true };
      setUser(localUser);
      localStorage.setItem('local_auth_user', JSON.stringify(localUser));
      
      if (authResult.status === 'active') {
        setUserRole(authResult.role);
        setAuthorizedState('authorized');
      } else {
        setUserRole(null);
        setAuthorizedState('pending');
      }
    } catch (err: any) {
      console.error("Auth Submission error:", err);
      let errMsg = err.message || "An authentication error occurred.";
      setAuthError(errMsg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem('local_auth_user');
      const response = await fetch('/api/db-status');
      const statusData = await response.json();
      const { auth } = getClientFirebase(statusData.firebaseConfig);
      if (auth) {
        await signOut(auth);
      }
    } catch (err: any) {
      console.error("Sign-out request failed:", err);
    } finally {
      setUser(null);
      setUserRole(null);
      setAuthorizedState('unauthenticated');
      setLoginPassword('');
    }
  };

  useEffect(() => {
    if (!confirmDeleteEmail) return;
    const timer = setTimeout(() => {
      setConfirmDeleteEmail(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [confirmDeleteEmail]);



  useEffect(() => {
    if (!confirmClearMacquarie) return;
    const timer = setTimeout(() => {
      setConfirmClearMacquarie(false);
    }, 4500);
    return () => clearTimeout(timer);
  }, [confirmClearMacquarie]);

  // Admin-only User Directory Operations
  const fetchUsersList = async () => {
    setUsersLoading(true);
    setUserDirError(null);
    try {
      const response = await fetch('/api/admin/users', {
        headers: {
          'X-User-Email': user?.email?.toLowerCase().trim() || ''
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to load users: HTTP ${response.status}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        setUsersList(data);
      }
    } catch (err: any) {
      console.error("Error fetching user list:", err);
      setUserDirError(err.message || "Failed to retrieve authorized user records.");
    } finally {
      setUsersLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setUserDirError(null);
    setUserDirSuccess(null);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': user?.email?.toLowerCase().trim() || ''
        },
        body: JSON.stringify({
          email: inviteEmail.toLowerCase().trim(),
          role: inviteRole
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to invite user");
      }
      setUserDirSuccess(`Successfully authorized ${inviteEmail.toLowerCase().trim()} as ${inviteRole}.`);
      setInviteEmail('');
      fetchUsersList(); // Reload table
    } catch (err: any) {
      console.error("Error inviting user:", err);
      setUserDirError(err.message || "Invitation failed.");
    }
  };

  const handleUpdateUserStatus = async (targetEmail: string, role: string, status: string) => {
    setUserDirError(null);
    setUserDirSuccess(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetEmail)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': user?.email?.toLowerCase().trim() || ''
        },
        body: JSON.stringify({ role, status })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update user");
      }
      setUserDirSuccess(`Successfully updated ${targetEmail}.`);
      fetchUsersList(); // Reload table
    } catch (err: any) {
      console.error("Error updating user:", err);
      setUserDirError(err.message || "Update failed.");
    }
  };

  const handleDeleteUser = async (targetEmail: string) => {
    setUserDirError(null);
    setUserDirSuccess(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetEmail)}`, {
        method: 'DELETE',
        headers: {
          'X-User-Email': user?.email?.toLowerCase().trim() || ''
        }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete user");
      }
      setUserDirSuccess(`Successfully deleted authorization record for ${targetEmail}.`);
      fetchUsersList(); // Reload table
    } catch (err: any) {
      console.error("Error deleting user:", err);
      setUserDirError(err.message || "Deletion failed.");
    }
  };

  // Restrict core data-fetching effects to authorized users only
  useEffect(() => {
    if (authorizedState !== 'authorized') return;

    wakeAndFetchDb(1, 12);
    fetchMacquarieStatus();

    const heartbeatId = setInterval(async () => {
      try {
        await fetch('/api/db-status');
      } catch (e) {
        console.debug('Cloud heartbeat background ping skipped.');
      }
    }, 110000);

    const savedLogs = localStorage.getItem('broadsheet_compliance_logs');
    if (savedLogs) {
      try {
        setLogs(JSON.parse(savedLogs));
      } catch (e) {
        console.error('Failed to parse logs:', e);
      }
    }

    const authHeaders: any = {};
    if (user && user.email) {
      authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
    }
    fetch('/api/session-logs', { headers: authHeaders })
      .then(res => {
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          return res.json();
        }
        throw new Error('Not JSON');
      })
      .then(data => {
        if (data && Array.isArray(data.logs)) {
          setLogs(data.logs);
          localStorage.setItem('broadsheet_compliance_logs', JSON.stringify(data.logs));
        }
      })
      .catch(err => {
        console.debug('Using cached offline logs index on mount:', err.message);
      });

    return () => clearInterval(heartbeatId);
  }, [authorizedState, user]);

  // Sync active review session log to history in real-time as corrections are made
  useEffect(() => {
    if (!activeLogId || issues.length === 0) return;
    
    const accepted = issues.filter(i => i.status === 'accepted').length;
    const ignored = issues.filter(i => i.status === 'rejected').length;
    const pending = issues.filter(i => i.status === 'pending').length;
    const reportText = generateReportText();
    const draftSummary = (currentDraft || copy || '').substring(0, 110).replace(/\s+/g, ' ').trim() + '...';
    
    // Compute word limit safely to prevent initialization scoping error
    const activeText = currentDraft || copy;
    const computedWordCount = activeText.trim() ? activeText.trim().split(/\s+/).length : 0;

    setLogs(prev => {
      const idx = prev.findIndex(l => l.id === activeLogId);
      let updated = [...prev];
      
      const logEntry: StyleReviewLog = {
        id: activeLogId,
        timestamp: idx !== -1 ? prev[idx].timestamp : new Date().toLocaleString('en-AU', { 
          timeZone: 'Australia/Sydney',
          dateStyle: 'medium',
          timeStyle: 'short'
        }),
        copyMode,
        wordCount: computedWordCount,
        totalSuggestions: issues.length,
        acceptedCount: accepted,
        ignoredCount: ignored,
        pendingCount: pending,
        reportMarkdown: reportText,
        draftSummary,
        originalCopyText: originalCopy || copy,
        logName: (customLogName.trim() ? customLogName : (idx !== -1 && prev[idx].logName ? prev[idx].logName : '')),
        currentDraftText: currentDraft || copy || '',
        aiCorrectedText: aiCorrectedText || (idx !== -1 && prev[idx].aiCorrectedText ? prev[idx].aiCorrectedText : ''),
        suggestions: issues
      };

      if (idx !== -1) {
        updated[idx] = logEntry;
      } else {
        updated = [logEntry, ...updated];
      }
      localStorage.setItem('broadsheet_compliance_logs', JSON.stringify(updated));

      // Asynchronously send updated log to shared Firestore database
      const authHeaders: any = {};
      if (user && user.email) {
        authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
      }
      fetch('/api/session-logs', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(logEntry)
      }).catch(err => {
        console.debug('Failed to sync session log to server database (using offline fallback):', err);
      });

      return updated;
    });
  }, [issues, currentDraft, activeLogId, copyMode, copy, originalCopy, customLogName, aiCorrectedText]);

  const deleteLog = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = logs.filter(l => l.id !== id);
    setLogs(updated);
    localStorage.setItem('broadsheet_compliance_logs', JSON.stringify(updated));
    if (selectedLogId === id) {
      setSelectedLogId(null);
    }
    if (activeLogId === id) {
      setActiveLogId(null);
    }

    // Delete log from shared Firestore database
    const authHeaders: any = {};
    if (user && user.email) {
      authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
    }
    fetch(`/api/session-logs/${id}`, { 
      method: 'DELETE',
      headers: authHeaders
    })
      .catch(err => {
        console.warn('Failed to delete session log from shared database:', err);
      });
  };

  const clearLogHistory = () => {
    let proceed = false;
    try {
      proceed = window.confirm('Are you sure you want to completely clear the entire review log history?');
    } catch (e) {
      console.warn('window.confirm blocked by sandbox, auto-proceeding:', e);
      proceed = true;
    }
    if (proceed) {
      setLogs([]);
      localStorage.removeItem('broadsheet_compliance_logs');
      setSelectedLogId(null);
      setActiveLogId(null);

      // Clear all session logs in shared Firestore database
      const authHeaders: any = {};
      if (user && user.email) {
        authHeaders['X-User-Email'] = user.email.toLowerCase().trim();
      }
      fetch('/api/session-logs/clear', { 
        method: 'POST',
        headers: authHeaders
      })
        .catch(err => {
          console.warn('Failed to clear session logs database:', err);
        });
    }
  };

  const loadOriginalCopyFromLog = (log: StyleReviewLog) => {
    let proceed = false;
    try {
      proceed = window.confirm('This will load the original copy from this session back into the editor, replacing your current draft. Continue?');
    } catch (e) {
      console.warn('window.confirm blocked by sandbox, auto-proceeding:', e);
      proceed = true;
    }
    if (proceed) {
      const cleanedText = cleanParagraphs(log.originalCopyText);
      setCopy(cleanedText);
      const initialHtml = generateParagraphHtml(cleanedText);
      setCopyHtml(initialHtml);
      setOriginalCopy('');
      setIssues([]);
      setEditMode(false);
      setShowLogsModal(false);
    }
  };

  const generateReportText = (customIssues?: StyleIssue[]) => {
    const activeIssues = customIssues || issues;
    const accepted = activeIssues.filter(i => i.status === 'accepted');
    const ignored = activeIssues.filter(i => i.status === 'rejected');
    const pending = activeIssues.filter(i => i.status === 'pending' || !i.status);
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    const total = activeIssues.length;
    const rate = total > 0 ? Math.round((accepted.length / total) * 100) : 100;

    let averageRate = rate;
    const historicalLogs = [...logs];
    if (activeLogId && !historicalLogs.some(l => l.id === activeLogId) && total > 0) {
      historicalLogs.unshift({
        id: activeLogId,
        timestamp: '',
        copyMode: 'editorial',
        wordCount: 0,
        totalSuggestions: total,
        acceptedCount: accepted.length,
        ignoredCount: ignored.length,
        pendingCount: pending.length,
        reportMarkdown: '',
        draftSummary: '',
        originalCopyText: '',
        suggestions: activeIssues
      });
    }

    if (historicalLogs.length > 0) {
      const sum = historicalLogs.reduce((acc, log) => {
        const logRate = log.totalSuggestions > 0 ? (log.acceptedCount / log.totalSuggestions) * 100 : 100;
        return acc + logRate;
      }, 0);
      averageRate = Math.round(sum / historicalLogs.length);
    }

    const barSize = 25;
    const filledCount = Math.round((rate / 100) * barSize);
    const textBar = '█'.repeat(filledCount) + '░'.repeat(Math.max(0, barSize - filledCount));

    const avgFilledCount = Math.round((averageRate / 100) * barSize);
    const avgTextBar = '█'.repeat(avgFilledCount) + '░'.repeat(Math.max(0, barSize - avgFilledCount));

    let markdown = `# BROADSHEET EDITORIAL STYLE REPORT\n`;
    markdown += `Generated: ${timestamp}\n`;
    markdown += `Copy Mode: EDITORIAL Styling\n`;
    markdown += `Word Count: ${copy ? copy.trim().split(/\s+/).length : 0} Words\n\n`;
    markdown += `======================================================================\n\n`;
    
    markdown += `## SESSION STATISTICS & COMPLIANCE RULES AUDIT\n`;
    markdown += `- Total Suggestions Identified:         ${activeIssues.length}\n`;
    markdown += `- Accepted Revisions (Applied to Draft): ${accepted.length}\n`;
    markdown += `- Ignored Recommendations (Retained Original): ${ignored.length}\n`;
    markdown += `- Left Pending Review:                  ${pending.length}\n\n`;
    
    markdown += `## STYLE GUIDE ACCEPTANCE METRICS\n`;
    markdown += `- Active Session Acceptance Rate:       [${textBar}] ${rate}% (${accepted.length} of ${activeIssues.length} suggestions applied)\n`;
    markdown += `- Running Average Acceptance Rate:      [${avgTextBar}] ${averageRate}% (calculated over ${historicalLogs.length} historical run records)\n\n`;
    
    markdown += `======================================================================\n\n`;

    markdown += `## 1. ACCEPTED STYLE CORRECTIONS (${accepted.length})\n`;
    if (accepted.length === 0) {
      markdown += `*No recommendations have been accepted in this session yet.*\n\n`;
    } else {
      accepted.forEach((item, idx) => {
        markdown += `### [Accepted #${idx + 1}] Rule Group: ${item.rule}\n`;
        markdown += `- Found Text:  "${item.original}"\n`;
        markdown += `- Corrected To: "${item.fix || '(Omitted/Deleted)'}"\n`;
        markdown += `- AI Comment: ${item.issue}\n`;
        markdown += `- Sub-editor Comment: \n\n`;
      });
    }

    markdown += `======================================================================\n\n`;
    markdown += `## 2. IGNORED / BYPASSED RECOMMENDATIONS (${ignored.length})\n`;
    if (ignored.length === 0) {
      markdown += `*No recommendations have been ignored in this session.*\n\n`;
    } else {
      ignored.forEach((item, idx) => {
        markdown += `### [Ignored #${idx + 1}] Rule Group: ${item.rule}\n`;
        markdown += `- Found Text:       "${item.original}"\n`;
        markdown += `- Suggested Fix:    "${item.fix || '(Omitted/Deleted)'}"\n`;
        markdown += `- AI Comment: ${item.issue}\n`;
        markdown += `- Sub-editor Comment: \n\n`;
      });
    }

    markdown += `======================================================================\n\n`;
    markdown += `## 3. PENDING RECOMMENDATIONS (${pending.length})\n`;
    if (pending.length === 0) {
      markdown += `*No recommendations are pending in this session.*\n\n`;
    } else {
      pending.forEach((item, idx) => {
        markdown += `### [Pending #${idx + 1}] Rule Group: ${item.rule}\n`;
        markdown += `- Found Text:       "${item.original}"\n`;
        markdown += `- Suggested Fix:    "${item.fix || '(Omitted/Deleted)'}"\n`;
        markdown += `- AI Comment: ${item.issue}\n`;
        markdown += `- Sub-editor Comment: \n\n`;
      });
    }

    markdown += `======================================================================\n`;
    markdown += `*Use this report to audit editor feedback or refine rule definitions in the synchronized database.*`;
    return markdown;
  };

  const copyReportToClipboard = () => {
    const text = customReportText !== null ? customReportText : generateReportText();
    navigator.clipboard.writeText(text).then(() => {
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    }).catch(() => {
      // Fallback if blocked
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setReportCopied(true);
        setTimeout(() => setReportCopied(false), 2000);
      } catch (e) {
        console.error('Manual copy failed', e);
      }
      document.body.removeChild(textarea);
    });
  };

  const handleClearMacquarie = async () => {
    try {
      const { data } = await safeFetchJson('/api/macquarie-dictionary/clear', {
        method: 'POST'
      });
      if (data && data.success) {
        setMacquarieStatus({ imported: false, wordCount: 0, fileSize: 0, sampleWords: [] });
        setMacquarieInput('');
        setMacquarieError('');
      }
    } catch (err) {
      console.error('Failed to clear Macquarie dictionary:', err);
    }
  };

  const handleImportMacquarie = async (rawData?: string) => {
    let jsonStr = '';
    if (rawData !== undefined) {
      jsonStr = rawData;
    } else if (macquarieFileContentRef.current !== null) {
      jsonStr = macquarieFileContentRef.current;
    } else {
      jsonStr = macquarieInput;
    }

    if (!jsonStr.trim()) {
      setMacquarieError('Please enter or paste your Macquarie Dictionary JSON content.');
      return;
    }

    setIsUploadingMacquarie(true);
    setMacquarieError('');
    try {
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e: any) {
        throw new Error(`Invalid JSON syntax: ${e.message}`);
      }

      let entriesCount = 0;
      if (Array.isArray(parsed)) {
        entriesCount = parsed.length;
      } else if (parsed && typeof parsed === 'object') {
        entriesCount = Object.keys(parsed).length;
      } else {
        throw new Error('JSON structure must be either an array of objects or a key-value map.');
      }

      if (entriesCount === 0) {
        throw new Error('Dictionary JSON contains zero definitions or items.');
      }

      const { data } = await safeFetchJson('/api/macquarie-dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dictionary: parsed })
      });

      if (data && data.success) {
        setMacquarieStatus(data.stats || { imported: true, wordCount: entriesCount, fileSize: jsonStr.length, sampleWords: [] });
        setMacquarieInput('');
        macquarieFileContentRef.current = null;
        fetchMacquarieStatus();
        setShowMacquarieManager(false);
      } else {
        setMacquarieError(data.error || 'Failed to import the dictionary.');
      }
    } catch (err: any) {
      setMacquarieError(err.message || 'An error occurred during import.');
    } finally {
      setIsUploadingMacquarie(false);
    }
  };

  const handleMacquarieDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleMacquarieDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== "application/json" && !file.name.endsWith('.json')) {
        setMacquarieError("Only JSON files are supported.");
        return;
      }
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target?.result as string;
        if (text) {
          macquarieFileContentRef.current = text;
          setMacquarieInput(`// Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)\n// Click the active 'Import & Save Dictionary' button below to import.`);
          setMacquarieError('');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleMacquarieFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== "application/json" && !file.name.endsWith('.json')) {
        setMacquarieError("Only JSON files are supported.");
        return;
      }
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target?.result as string;
        if (text) {
          macquarieFileContentRef.current = text;
          setMacquarieInput(`// Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)\n// Click the active 'Import & Save Dictionary' button below to import.`);
          setMacquarieError('');
        }
      };
      reader.readAsText(file);
    }
  };

  const fetchMacquarieStatus = async (attempt = 1, maxAttempts = 12) => {
    try {
      const { data } = await safeFetchJson('/api/macquarie-dictionary/status');
      if (data) {
        setMacquarieStatus(data);
      }
    } catch (err) {
      console.warn(`Failed to fetch Macquarie dictionary status (attempt ${attempt}/${maxAttempts}):`, err);
      if (attempt < maxAttempts) {
        setTimeout(() => {
          fetchMacquarieStatus(attempt + 1, maxAttempts);
        }, 2000);
      } else {
        console.error('Final Macquarie dictionary status fetch failed:', err);
      }
    }
  };

  const handleSyncMacquarieFromDb = async () => {
    if (isSyncingMacquarie) return;
    setIsSyncingMacquarie(true);
    try {
      const { data } = await safeFetchJson('/api/macquarie-dictionary/sync-from-db', {
        method: 'POST'
      });
      if (data && data.success) {
        setMacquarieStatus(data.status);
        console.log('Macquarie database sync succeeded:', data.message);
      } else {
        console.warn('Sync warning:', data?.error || 'Unknown response');
      }
    } catch (err) {
      console.error('Failed to sync Macquarie dictionary from Firestore:', err);
    } finally {
      setIsSyncingMacquarie(false);
    }
  };




  // Selection/Focus States
  const [selectedIssueIndex, setSelectedIssueIndex] = useState<number | null>(null);
  const [selectedReviewFilter, setSelectedReviewFilter] = useState<'all' | 'style' | 'consistency' | 'dictionary'>('all');
  const [isCopied, setIsCopied] = useState(false);
  const [isOriginalCopied, setIsOriginalCopied] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // References
  const editorRef = useRef<HTMLDivElement>(null);
  const inputEditorRef = useRef<HTMLDivElement>(null);
  const issueRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  const wordCount = useMemo(() => {
    const text = currentDraft || copy;
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }, [currentDraft, copy]);

  const handleReview = async (textToReview?: string) => {
    let sourceHtml = textToReview !== undefined 
      ? (currentDraftHtml || generateParagraphHtml(textToReview))
      : (copyHtml || generateParagraphHtml(copy));
    
    // Normalize quotes immediately so UI matches server
    sourceHtml = enforceSmartQuotesOnHtml(sourceHtml);
    
    let targetText = htmlToPlainText(sourceHtml, { preserveMarkdown: true }) || (textToReview !== undefined ? textToReview : copy);
    targetText = enforceSmartQuotes(targetText);
    
    if (!targetText.trim()) return;
    
    setLoading(true);
    setLoadingStage('style');
    setError(null);
    setSelectedIssueIndex(null);
    
    let allIssues: StyleIssue[] = [];
    let initialHtml = sourceHtml;
    
    // Optimistically update the UI to normalized text right away
    setCurrentDraft(targetText);
    setCurrentDraftHtml(initialHtml);
    setCopyHtml(initialHtml);
    
    try {
      // Stage 1: Style Check
      const { data: styleData } = await safeFetchJson('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copy: targetText, copyMode, enableSocialMediaGuidelines, enableThinkingMode: userRole !== 'editor' && enableThinkingMode }),
      });
      
      if (styleData.error) {
        throw new Error(styleData.error);
      }
      
      const parsedStyleIssues: StyleIssue[] = (styleData.issues || []).map((issue: any) => ({
        ...issue,
        status: 'pending',
        type: 'style'
      }));
      
      allIssues = [...parsedStyleIssues];

      // Stage 2: Consistency & Context Check
      setLoadingStage('consistency');
      const { data: consistencyData } = await safeFetchJson('/api/consistency-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copy: targetText, headline: '', enableThinkingMode: userRole !== 'editor' && enableThinkingMode }),
      });
      
      if (consistencyData.error) {
        throw new Error(consistencyData.error);
      }
      
      const parsedConsistencyIssues: StyleIssue[] = (consistencyData.issues || []).map((issue: any) => ({
        ...issue,
        status: 'pending',
        type: 'consistency'
      }));

      // Combine results
      allIssues = [...allIssues, ...parsedConsistencyIssues];

      // Stage 3: Dictionary & Banned Words Check
      setLoadingStage('dictionary');
      const { data: dictionaryData } = await safeFetchJson('/api/dictionary-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copy: targetText, enableThinkingMode: userRole !== 'editor' && enableThinkingMode }),
      });
      
      if (dictionaryData.error) {
        throw new Error(dictionaryData.error);
      }
      
      const parsedDictionaryIssues: StyleIssue[] = (dictionaryData.issues || []).map((issue: any) => ({
        ...issue,
        status: 'pending',
        type: 'dictionary'
      }));

      // Combine results
      allIssues = [...allIssues, ...parsedDictionaryIssues];
      
      // Update state with all results at once to avoid premature UI transition
      setIssues(allIssues);
      setOriginalCopy(targetText);
      setOriginalCopyHtml(initialHtml);
      setCurrentDraft(targetText);
      setCurrentDraftHtml(initialHtml);
      setAiCorrectedText(styleData.correctedCopy || targetText);
      setActiveLogId('log_' + Date.now());

      if (allIssues.length > 0) {
        setSelectedIssueIndex(0);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while analyzing the copy.');
    } finally {
      setLoading(false);
      setLoadingStage('idle');
    }
  };

  // Stats
  const stats = useMemo(() => {
    const total = issues.length;
    if (total === 0) return { pending: 0, accepted: 0, rejected: 0, notes: 0, score: 100 };
    
    const pending = issues.filter(i => i.status === 'pending').length;
    const accepted = issues.filter(i => i.status === 'accepted').length;
    const rejected = issues.filter(i => i.status === 'rejected').length;
    const notes = issues.filter(i => i.isNote).length;
    const rules = total - notes;
    
    // Calculate custom style score: rules accepted/dismissed vs total rules
    const resolvedRules = issues.filter(i => !i.isNote && i.status !== 'pending').length;
    const totalRules = issues.filter(i => !i.isNote).length;
    const score = totalRules > 0 ? Math.round((resolvedRules / totalRules) * 100) : 100;

    return { pending, accepted, rejected, notes, score };
  }, [issues]);

  
  // Helper to extract text and HTML from highlighted DOM
  const extractFromHighlighted = (doc) => {
    const allBtns = doc.querySelectorAll('button[data-issue-idx]');
    allBtns.forEach(btn => {
      const parent = btn.parentNode;
      if (parent) {
        while (btn.firstChild) {
          parent.insertBefore(btn.firstChild, btn);
        }
        parent.removeChild(btn);
      }
    });
    return { 
      html: doc.body.innerHTML, 
      text: htmlToPlainText(doc.body.innerHTML, { preserveMarkdown: true }) 
    };
  };

  // Handle Accept Suggestion

  const handleAccept = (index: number) => {
    const issue = issues[index];
    if (issue.status !== 'pending') return;

    const isAdvisory = issue.isNote || !issue.fix || isAdvisoryInstruction(issue.fix);

    const parser = new DOMParser();
    const doc = parser.parseFromString(highlightedHtml, 'text/html');
    const targetBtn = doc.querySelector(`button[data-issue-idx="${index}"]`);
    
    if (targetBtn) {
      if (isAdvisory) {
        // Advisory guidance / note: unwrap targetBtn preserving original text in place
        while (targetBtn.firstChild) {
          targetBtn.parentNode?.insertBefore(targetBtn.firstChild, targetBtn);
        }
        targetBtn.parentNode?.removeChild(targetBtn);
      } else {
        // Text replacement
        const fixContainer = doc.createElement('div');
        fixContainer.innerHTML = formatMarkdownToHtml(issue.fix);
        while (fixContainer.firstChild) {
          targetBtn.parentNode?.insertBefore(fixContainer.firstChild, targetBtn);
        }
        targetBtn.parentNode?.removeChild(targetBtn);
      }
      
      const { html, text } = extractFromHighlighted(doc);
      setCurrentDraftHtml(html);
      setCurrentDraft(text);
    } else {
      // Fallback
      if (!isAdvisory) {
        const text = currentDraft;
        const original = issue.original;
        const fix = issue.fix;
        let findIndex = text.indexOf(original);
        let matchLength = original.length;
        if (findIndex === -1) {
          const fuzzy = findFuzzyMatch(text, original);
          if (fuzzy) {
            findIndex = fuzzy.index;
            matchLength = fuzzy.length;
          }
        }
        if (findIndex !== -1) {
          const updatedText = text.slice(0, findIndex) + fix + text.slice(findIndex + matchLength);
          setCurrentDraft(updatedText);
        }
        const updatedHtml = replaceInHtml(currentDraftHtml, original, fix);
        setCurrentDraftHtml(updatedHtml);
      }
    }

    setIssues(prev => prev.map((item, idx) => idx === index ? { ...item, status: 'accepted' } : item));
    
    const nextPending = issues.findIndex((item, idx) => idx > index && item.status === 'pending');
    if (nextPending !== -1) {
      setSelectedIssueIndex(nextPending);
    } else {
      const firstPending = issues.findIndex((item) => item.status === 'pending');
      setSelectedIssueIndex(firstPending !== -1 ? firstPending : null);
    }
  };

  // Handle Reject Suggestion

  const handleReject = (index: number) => {
    setIssues(prev => prev.map((item, idx) => idx === index ? { ...item, status: 'rejected' } : item));
    
    const nextPending = issues.findIndex((item, idx) => idx > index && item.status === 'pending');
    if (nextPending !== -1) {
      setSelectedIssueIndex(nextPending);
    } else {
      const firstPending = issues.findIndex((item) => item.status === 'pending');
      setSelectedIssueIndex(firstPending !== -1 ? firstPending : null);
    }
  };

  // Handle Undo/Reset Suggestion

  const handleUndo = (index: number) => {
    const issue = issues[index];
    if (issue.status === 'accepted') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(highlightedHtml, 'text/html');
      const targetBtn = doc.querySelector(`button[data-issue-idx="${index}"]`);
      
      if (targetBtn) {
        const fixContainer = doc.createElement('div');
        fixContainer.innerHTML = formatMarkdownToHtml(issue.original);
        while (fixContainer.firstChild) {
          targetBtn.parentNode?.insertBefore(fixContainer.firstChild, targetBtn);
        }
        targetBtn.parentNode?.removeChild(targetBtn);
        
        const { html, text } = extractFromHighlighted(doc);
        setCurrentDraftHtml(html);
        setCurrentDraft(text);
      } else {
        // Fallback
        const text = currentDraft;
        const original = issue.original;
        const fix = issue.fix;
        let findFixIndex = text.indexOf(fix);
        let fixLength = fix.length;
        if (findFixIndex === -1 && fix.length > 0) {
          const fuzzy = findFuzzyMatch(text, fix);
          if (fuzzy) {
            findFixIndex = fuzzy.index;
            fixLength = fuzzy.length;
          }
        }
        if (findFixIndex !== -1 && fix.length > 0) {
          const updatedText = text.slice(0, findFixIndex) + original + text.slice(findFixIndex + fixLength);
          setCurrentDraft(updatedText);
        }
        if (fix.length > 0) {
          const updatedHtml = replaceInHtml(currentDraftHtml, fix, original);
          setCurrentDraftHtml(updatedHtml);
        }
      }
    }
    setIssues(prev => prev.map((item, idx) => idx === index ? { ...item, status: 'pending' } : item));
    setSelectedIssueIndex(index);
  };

  // Auto apply all strict corrections

  const handleAutoApplyAll = () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(highlightedHtml, 'text/html');
    let domChanged = false;

    const updatedIssues = issues.map((issue, index) => {
      if (issue.status === 'pending' && !issue.isNote && issue.fix && !isAdvisoryInstruction(issue.fix)) {
        const targetBtn = doc.querySelector(`button[data-issue-idx="${index}"]`);
        if (targetBtn) {
          domChanged = true;
          const fixContainer = doc.createElement('div');
          fixContainer.innerHTML = formatMarkdownToHtml(issue.fix);
          while (fixContainer.firstChild) {
            targetBtn.parentNode?.insertBefore(fixContainer.firstChild, targetBtn);
          }
          targetBtn.parentNode?.removeChild(targetBtn);
        }
        return { ...issue, status: 'accepted' as const };
      }
      return issue;
    });

    if (domChanged) {
      const { html, text } = extractFromHighlighted(doc);
      setCurrentDraftHtml(html);
      setCurrentDraft(text);
    }
    setIssues(updatedIssues);
    setSelectedIssueIndex(null);
  };

  const copyToClipboard = () => {
    const rawPlain = cleanParagraphs(currentDraft);
    const text = rawPlain.replace(/[\*_]/g, '');
    const rawHtml = currentDraftHtml || generateParagraphHtml(rawPlain);
    const clipboardHtml = prepareHtmlForClipboard(rawHtml);
    
    try {
      const textBlob = new Blob([text], { type: 'text/plain' });
      const htmlBlob = new Blob([clipboardHtml], { type: 'text/html' });
      navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob,
        })
      ]).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      }).catch(() => {
        // Fallback
        navigator.clipboard.writeText(text).then(() => {
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        });
      });
    } catch (err) {
      navigator.clipboard.writeText(text).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      });
    }
  };

  const copyOriginalToClipboard = () => {
    const rawPlain = cleanParagraphs(originalCopy);
    const text = rawPlain.replace(/[\*_]/g, '');
    const rawHtml = originalCopyHtml || generateParagraphHtml(rawPlain);
    const clipboardHtml = prepareHtmlForClipboard(rawHtml);

    try {
      const textBlob = new Blob([text], { type: 'text/plain' });
      const htmlBlob = new Blob([clipboardHtml], { type: 'text/html' });
      navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob,
        })
      ]).then(() => {
        setIsOriginalCopied(true);
        setTimeout(() => setIsOriginalCopied(false), 2000);
      }).catch(() => {
        // Fallback
        navigator.clipboard.writeText(text).then(() => {
          setIsOriginalCopied(true);
          setTimeout(() => setIsOriginalCopied(false), 2000);
        });
      });
    } catch (err) {
      navigator.clipboard.writeText(text).then(() => {
        setIsOriginalCopied(true);
        setTimeout(() => setIsOriginalCopied(false), 2000);
      });
    }
  };

  // Watch selected state and scroll both the issue card and the workspace text into view
  useEffect(() => {
    if (selectedIssueIndex !== null) {
      if (issueRefs.current[selectedIssueIndex]) {
        issueRefs.current[selectedIssueIndex]?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }
      
      // Attempt to scroll the right-hand panel highlight into view
      setTimeout(() => {
        const highlightEl = document.querySelector(`button[data-issue-idx="${selectedIssueIndex}"]`);
        if (highlightEl) {
          highlightEl.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
          });
        }
      }, 50); // slight delay to ensure HTML is rendered
    }
  }, [selectedIssueIndex]);

  // Sync HTML state into manual editor div upon toggling/entering editMode
  useEffect(() => {
    if (editMode && editorRef.current) {
      if (editorRef.current.innerHTML !== currentDraftHtml) {
        editorRef.current.innerHTML = currentDraftHtml || '';
      }
    }
  }, [editMode, currentDraftHtml]);

  // Sync back input editors
  useEffect(() => {
    if (!originalCopy && inputEditorRef.current) {
      if (inputEditorRef.current.innerHTML !== copyHtml) {
        inputEditorRef.current.innerHTML = copyHtml || '';
      }
    }
  }, [copyHtml, originalCopy]);

  const handleInputEditorChange = () => {
    if (inputEditorRef.current) {
      const html = inputEditorRef.current.innerHTML;
      const text = htmlToPlainText(html, { preserveMarkdown: true });
      setCopy(text);
      setCopyHtml(html);
    }
  };

  const handleInputEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const htmlData = e.clipboardData.getData('text/html');
    const plainTextData = e.clipboardData.getData('text/plain');

    let cleanedHtml = '';

    if (htmlData && htmlData.trim()) {
      cleanedHtml = cleanPastedHtml(htmlData);
    }

    if (!cleanedHtml && plainTextData && plainTextData.trim()) {
      const cleanText = plainTextData.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
      cleanedHtml = generateParagraphHtml(cleanText);
    }

    if (cleanedHtml) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cleanedHtml;
        const fragment = document.createDocumentFragment();
        let lastNode: Node | null = null;
        let childNode: Node | null = null;
        while ((childNode = tempDiv.firstChild)) {
          lastNode = fragment.appendChild(childNode);
        }
        range.insertNode(fragment);
        if (lastNode) {
          range.setStartAfter(lastNode);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }

    if (inputEditorRef.current) {
      const updatedHtml = inputEditorRef.current.innerHTML;
      const updatedText = htmlToPlainText(updatedHtml, { preserveMarkdown: true });
      setCopy(updatedText);
      setCopyHtml(updatedHtml);
    }
  };

  const handleEditorChange = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      const text = htmlToPlainText(html, { preserveMarkdown: true });
      setCurrentDraftHtml(html);
      setCurrentDraft(text);
    }
  };

  const handleManualEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const htmlData = e.clipboardData.getData('text/html');
    const plainTextData = e.clipboardData.getData('text/plain');

    let cleanedHtml = '';

    if (htmlData && htmlData.trim()) {
      cleanedHtml = cleanPastedHtml(htmlData);
    }

    if (!cleanedHtml && plainTextData && plainTextData.trim()) {
      const cleanText = plainTextData.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
      cleanedHtml = generateParagraphHtml(cleanText);
    }

    if (cleanedHtml) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cleanedHtml;
        const fragment = document.createDocumentFragment();
        let lastNode: Node | null = null;
        let childNode: Node | null = null;
        while ((childNode = tempDiv.firstChild)) {
          lastNode = fragment.appendChild(childNode);
        }
        range.insertNode(fragment);
        if (lastNode) {
          range.setStartAfter(lastNode);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }

    if (editorRef.current) {
      const updatedHtml = editorRef.current.innerHTML;
      const updatedText = htmlToPlainText(updatedHtml, { preserveMarkdown: true });
      setCurrentDraftHtml(updatedHtml);
      setCurrentDraft(updatedText);
    }
  };

  const highlightedHtml = useMemo(() => {
    if (!currentDraftHtml) return '';
    const allIssues = issues
      .map((issue, idx) => ({ ...issue, idx }));
    return getHighlightedHtml(currentDraftHtml, allIssues, selectedIssueIndex, theme);
  }, [currentDraftHtml, issues, selectedIssueIndex, theme]);

  const handleWorkspaceClick = (e: React.MouseEvent<HTMLElement>) => {
    const btn = (e.target as HTMLElement).closest('button[data-issue-idx]');
    if (btn) {
      const idx = parseInt(btn.getAttribute('data-issue-idx') || '', 10);
      if (!isNaN(idx)) {
        setSelectedIssueIndex(idx);
      }
    }
  };

  // Gate render redirects based on authorization state
  if (authorizedState === 'checking') {
    return (
      <div className="min-h-screen w-full bg-[#FAF9F6] text-zinc-900 flex flex-col items-center justify-center font-sans px-4">
        <div className="max-w-md w-full text-center p-8 flex flex-col items-center space-y-6">
          <div className="w-10 h-10 rounded-full border-2 border-t-zinc-900 border-zinc-200 animate-spin" />
          <div>
            <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-400">Broadsheet Compliance</h2>
            <p className="text-xs text-zinc-500 mt-2">Checking authorization credentials with cloud database...</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[10px] uppercase font-mono tracking-widest text-zinc-400 select-none">
          <Lock className="w-3 h-3 text-zinc-400" />
          <span>Internal Use Only • Broadsheet Media</span>
        </div>
      </div>
    );
  }

  if (authorizedState === 'pending') {
    return (
      <div className="min-h-screen w-full bg-[#FAF9F6] text-[#09090B] flex flex-col items-center justify-center font-sans px-4">
        <div className="max-w-md w-full bg-white border border-zinc-200 p-8 md:p-10 shadow-2xl flex flex-col items-center text-center space-y-6 relative rounded">
          <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-600 border border-amber-200">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black tracking-tight uppercase">Access Pending Authorization</h2>
            <p className="text-xs text-zinc-400 mt-2 font-mono break-all">{user?.email}</p>
            <p className="text-xs text-zinc-700 mt-4 leading-relaxed">
              Your account has been registered, but your email has not yet been Whitelisted. 
              Broadsheet's internal compliance tools require an Administrator to authorize your email address before you can verify copy.
            </p>
          </div>
          <div className="w-full pt-4 flex gap-3">
            <button
              onClick={() => {
                setAuthorizedState('checking');
                const savedLocalUser = localStorage.getItem('local_auth_user');
                let emailToRefresh = '';
                try {
                  if (savedLocalUser) {
                    emailToRefresh = JSON.parse(savedLocalUser).email;
                  }
                } catch(err) {}
                if (!emailToRefresh && user && user.email) {
                  emailToRefresh = user.email;
                }

                if (emailToRefresh) {
                  const cleanEmail = emailToRefresh.toLowerCase().trim();
                  fetch('/api/auth/me', {
                    headers: { 'X-User-Email': cleanEmail }
                  })
                  .then(async (res) => {
                    if (res.ok) {
                      const data = await res.json();
                      setUserRole(data.role);
                      setAuthorizedState('authorized');
                    } else {
                      const data = await res.json();
                      if (data && data.status === 'pending') {
                        setAuthorizedState('pending');
                      } else {
                        localStorage.removeItem('local_auth_user');
                        setUser(null);
                        setUserRole(null);
                        setAuthorizedState('unauthenticated');
                      }
                    }
                  })
                  .catch((e) => {
                    console.error(e);
                    setAuthorizedState('pending');
                  });
                } else {
                  setAuthorizedState('unauthenticated');
                }
              }}
              className="flex-1 py-2.5 bg-zinc-950 text-white rounded text-xs font-bold uppercase hover:bg-zinc-900 active:translate-y-0.5 transition cursor-pointer"
            >
              Refresh Status
            </button>
            <button
              onClick={handleLogout}
              className="flex-1 py-2.5 bg-white text-zinc-900 border border-zinc-300 rounded text-xs font-bold uppercase hover:bg-zinc-50 active:translate-y-0.5 transition cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2 text-[10px] uppercase font-mono tracking-widest text-zinc-400 select-none">
          <Lock className="w-3 h-3 text-zinc-400" />
          <span>Internal Use Only • Broadsheet Media</span>
        </div>
      </div>
    );
  }

  if (authorizedState === 'unauthenticated') {
    return (
      <div className="min-h-screen w-full bg-[#FAF9F6] text-[#09090B] flex flex-col items-center justify-center font-sans px-4">
        <div className="max-w-md w-full bg-white border border-zinc-200/80 p-8 md:p-10 shadow-2xl space-y-6 rounded relative">
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight text-gray-900 leading-none m-0">
              Broadsheet <span className="text-[#0055FF]">Style Checker</span>
            </h1>
            <p className="text-[11px] text-zinc-500 font-medium tracking-wide mt-2 select-none">
              Editorial Style Guide &amp; Verification Tool
            </p>
          </div>

          {authError && (
            <div className="p-3.5 bg-red-50 text-red-700 border border-red-200 text-xs rounded leading-relaxed flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-650 block">Email Address</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="editor@broadsheet.com.au"
                className="w-full px-3.5 py-2.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0055FF] focus:border-[#0055FF] bg-zinc-50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-650 block">Password</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0055FF] focus:border-[#0055FF] bg-zinc-50"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 bg-zinc-950 text-white rounded text-xs font-bold uppercase hover:bg-zinc-900 active:translate-y-0.5 transition disabled:opacity-50 cursor-pointer tracking-wider"
            >
              {authLoading ? 'Signing In...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="text-center pt-3 border-t border-zinc-100">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setAuthError(null);
              }}
              className="text-[#0055FF] hover:underline cursor-pointer bg-transparent border-none outline-none font-semibold tracking-wide text-xs"
            >
              {isSignUp ? "Already have an account? Sign in here" : "New to the Style Checker? Create an account"}
            </button>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2 text-[10px] uppercase font-mono tracking-widest text-zinc-400 select-none">
          <Lock className="w-3 h-3 text-zinc-400" />
          <span>Internal Use Only • Broadsheet Media</span>
        </div>
      </div>
    );
  }

  const currentTheme = THEMES[theme];

  const svgWidth = 500;
  const svgHeight = 60;
  const paddingX = 40;
  const paddingY = 12;

  return (
    <div className={currentTheme.container}>
      
      {/* Editorial Header */}
      <header className={currentTheme.header}>
        <div className="flex flex-col">
          <h1 className={currentTheme.title}>
            Broadsheet <span className={currentTheme.accentText}>Style Checker</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 md:gap-2 max-w-full">

          {/* Macquarie Sync Pill */}
          <div>
            {isSyncingMacquarie ? (
              <div className="px-2 py-1 flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border bg-blue-50/50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900 text-blue-500 animate-pulse select-none">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Syncing...
              </div>
            ) : macquarieStatus?.imported ? (
              <button
                onClick={handleSyncMacquarieFromDb}
                title="Click to Sync & Refresh Custom Dictionary from Database"
                className={`px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase cursor-pointer border transition-all active:translate-y-0.5 group outline-none ${
                  theme === 'dark'
                    ? 'bg-emerald-950/40 border-emerald-800 hover:bg-emerald-900 text-emerald-400'
                    : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100 text-emerald-700'
                }`}
              >
                <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-all duration-500 ease-out" />
                Dictionary ({macquarieStatus.wordCount.toLocaleString()})
              </button>
            ) : macquarieStatus && macquarieStatus.wordCount > 0 ? (
              <button
                onClick={handleSyncMacquarieFromDb}
                title="Click to Sync & Sync/Pull Custom Dictionary from Database"
                className={`px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase cursor-pointer border transition-all active:translate-y-0.5 group outline-none ${
                  theme === 'dark'
                    ? 'bg-blue-950/40 border-blue-900 hover:bg-blue-900 text-blue-400'
                    : 'bg-blue-50 border-blue-200 hover:bg-blue-100/90 text-blue-600'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-pulse group-hover:rotate-180 transition-all duration-500 ease-out" />
                Baseline ({macquarieStatus.wordCount.toLocaleString()})
              </button>
            ) : (
              <button
                onClick={handleSyncMacquarieFromDb}
                title="Click to Sync & Pull Custom Dictionary from Database"
                className={`px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase cursor-pointer border transition-all active:translate-y-0.5 group outline-none ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-400'
                    : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100 text-zinc-500'
                }`}
              >
                <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-all duration-500 ease-out" />
                Sync Dictionary
              </button>
            )}
          </div>

          {/* Feedback Button for All Users */}
          <button
            onClick={() => {
              setShowFeedbackModal(true);
              setFeedbackError(null);
              setFeedbackSuccess(false);
            }}
            className="px-2.5 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 hover:scale-[1.02] shadow-sm hover:shadow active:scale-[0.98] outline-none group bg-[#0055FF] text-white border-blue-600 hover:bg-blue-600"
            title="Provide feedback, UX requests, or report AI errors"
          >
            <MessageSquarePlus className="w-3.5 h-3.5 text-blue-100 group-hover:scale-110 transition-transform" />
            Feedback
          </button>

          {/* Data Safeguards & Privacy Modal Trigger (Admin-only) */}
          {userRole === 'admin' && (
            <button
              onClick={() => {
                setShowPrivacyModal(true);
                fetchPrivacyStatus();
              }}
              className="px-2.5 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 hover:scale-[1.02] shadow-sm hover:shadow active:scale-[0.98] outline-none group bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700"
              title="View Broadsheet Data Protection & Third-Party AI Training Safeguards"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-100 group-hover:scale-110 transition-transform" />
              <span>Data Safeguards</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-200 animate-pulse"></span>
            </button>
          )}

          {/* Feedback Hub for Admins */}
          {userRole === 'admin' && (
            <button
              onClick={() => {
                setShowFeedbackHub(true);
                fetchFeedbackList();
              }}
              className={`px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 hover:scale-[1.02] shadow-sm hover:shadow active:scale-[0.98] outline-none group ${
                theme === 'dark'
                  ? 'bg-amber-950/40 border-amber-800/80 text-amber-300 hover:bg-amber-900/60'
                  : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
              }`}
              title="View team feedback submissions, UX requests, and reported AI errors"
            >
              <MessageSquare className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 transition-transform" />
              Submissions
            </button>
          )}

          {/* Usage Stats for Admins only */}
          {userRole === 'admin' && (
            <button
              onClick={() => {
                setShowUsageStatsModal(true);
                fetchUsageStats();
              }}
              className={`px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 hover:scale-[1.02] shadow-sm hover:shadow active:scale-[0.98] outline-none group ${
                theme === 'dark'
                  ? 'bg-indigo-950/40 border-indigo-800/80 text-indigo-300 hover:bg-indigo-900/60'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100'
              }`}
              title="View Admin Usage & Activity Statistics"
            >
              <BarChart3 className="w-3.5 h-3.5 text-indigo-500 group-hover:scale-110 transition-transform" />
              Usage Stats
            </button>
          )}

          {/* Access Control (User Directory) for Admins only */}
          {userRole === 'admin' && (
            <button
              onClick={() => {
                setShowUserDirectory(true);
                fetchUsersList();
              }}
              className="px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 hover:scale-[1.02] shadow-sm hover:shadow active:scale-[0.98] outline-none group bg-zinc-950 text-white border-zinc-800 hover:bg-zinc-900"
              title="Access Control & User Directory"
            >
              <Users className="w-3.5 h-3.5 text-blue-400" />
              Users
            </button>
          )}

          {/* Session Logs */}
          {userRole === 'admin' && (
            <button
              onClick={() => {
                setShowLogsModal(true);
                if (logs.length > 0 && !selectedLogId) {
                  setSelectedLogId(logs[0].id);
                }
              }}
              className={`px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 hover:scale-[1.02] shadow-sm hover:shadow active:scale-[0.98] outline-none group ${
                theme === 'dark'
                  ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/80 hover:border-zinc-700 text-zinc-200 hover:text-white'
                  : 'bg-white border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 text-[#0055FF]'
              }`}
              title="View session review logs"
            >
              <History className="w-3.5 h-3.5 text-blue-500 group-hover:-rotate-12 transition-transform duration-300" />
              Logs ({logs.length})
            </button>
          )}

          {/* Macquarie Dict Management */}
          {userRole === 'admin' && (
            <button
              onClick={() => setShowMacquarieManager(true)}
              className={`px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 hover:scale-[1.02] shadow-sm hover:shadow active:scale-[0.98] outline-none group ${
                theme === 'dark'
                  ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/80 hover:border-zinc-700 text-zinc-200 hover:text-white'
                  : 'bg-white border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 hover:text-[#0055FF] text-[#0141C8]'
              }`}
              title="Manage Custom Macquarie Dictionary"
            >
              <Database className="w-3.5 h-3.5 text-blue-500 group-hover:scale-110 group-hover:translate-y-[-1px] transition-transform duration-300" />
              Dictionary
            </button>
          )}

          {/* Aligne DB Corpus */}
          {userRole === 'admin' && (
            <button
              onClick={() => {
                setShowDbLogsModal(true);
              }}
              className={`px-2 py-1 select-none flex items-center gap-1.5 rounded text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 hover:scale-[1.02] shadow-sm hover:shadow active:scale-[0.98] outline-none group relative ${
                dbError
                  ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-500 hover:bg-red-100/80'
                  : theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/80 hover:border-zinc-700 text-zinc-200 hover:text-white'
                    : 'bg-white border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 hover:text-[#0055FF] text-[#0141C8]'
              }`}
              title={dbError ? `Database error: ${dbError}. Click to view fallback log and resolve.` : "View global shared human discrepancy feedback corpus stored in Firestore"}
            >
              {dbError ? (
                <AlertCircle className="w-3.5 h-3.5 text-red-500 animate-pulse group-hover:scale-110 transition-transform duration-300" />
              ) : (
                <Database className="w-3.5 h-3.5 text-blue-500 group-hover:scale-110 group-hover:translate-y-[-1px] transition-transform duration-300" />
              )}
              Corpus ({dbLogs.length})
              {dbError && (
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
              )}
            </button>
          )}

          {/* User Status / Logout Card */}
          {user && (
            <div className="flex items-center gap-1.5 border-l pl-2.5 ml-1 border-zinc-200 dark:border-zinc-800 shrink-0">
              <span className="text-[11px] font-mono truncate max-w-[120px] dark:text-zinc-300 text-zinc-600" title={`Authenticated User (${userRole || 'Editor'}): ${user.email}`}>
                {user.email ? user.email.split('@')[0] : 'user'}
              </span>
              <button
                onClick={handleLogout}
                className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 text-red-600 rounded transition cursor-pointer"
                title={`Logout ${user.email}`}
              >
                Logout
              </button>
            </div>
          )}

        </div>
      </header>

      {/* Main split dashboard view */}
      <main className="flex-1 flex flex-row overflow-hidden relative">
        <AnimatePresence mode="wait">
          {!originalCopy || isDirectAuditFlow ? (
            /* Input Page View (State: Editing Copy before Analysis) */
            <motion.div 
              key="input-screen"
              className={`absolute inset-0 p-6 md:p-8 flex flex-col transition-all overflow-hidden ${
                theme === 'dark' ? 'bg-[#09090B]' : 'bg-[#FAF9F6]'
              }`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="w-full max-w-6xl mx-auto flex-1 flex flex-col gap-5 h-full overflow-hidden">
                {/* Immersive Top Toolbar Header Row */}
                <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b shrink-0 ${
                  theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
                }`}>
                  <div className="space-y-2.5">
                    <h2 className={`text-xl font-bold uppercase tracking-tight ${
                      theme === 'dark' 
                        ? 'text-zinc-100' 
                        : 'text-zinc-900'
                    }`}>
                       Style Guide Editing Tool
                    </h2>

                    {/* Workspace Segment Switcher */}
                    <div className="flex bg-[#0c0c0e] border border-zinc-800 rounded p-0.5 gap-0.5 select-none w-fit">
                      <button
                        onClick={() => { 
                          setShowCrossCheck(false); 
                          setIsDirectAuditFlow(false);
                          // Clear active direct audit state to return to a fresh writing canvas
                          setOriginalCopy('');
                          setCurrentDraft('');
                          setCopy('');
                          setCopyHtml('');
                          setIssues([]);
                          setCrossCheckAnalysis(null);
                          setSelectedSessionLogForAudit(null);
                          setHumanFinalizedCopy('');
                        }}
                        className={`text-[10px] uppercase font-bold px-3 py-1 rounded cursor-pointer transition-all ${
                          !showCrossCheck
                            ? 'bg-blue-600 text-white font-extrabold'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        New Style Check
                      </button>
                      {(userRole === 'admin' || userRole === 'sub-editor') && (
                        <button
                          onClick={() => { 
                            setShowCrossCheck(true); 
                            setIsDirectAuditFlow(true);
                          }}
                          className={`text-[10px] uppercase font-bold px-3 py-1 rounded cursor-pointer transition-all ${
                            showCrossCheck
                              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-extrabold'
                              : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          Sub-Editor Audit
                        </button>
                      )}
                    </div>

                    {logs.length > 0 && !showCrossCheck && (
                      <div className="mt-1 flex flex-col gap-1.5">

                        <select
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border focus:outline-none focus:ring-1 transition-all max-w-[300px] cursor-pointer ${
                            theme === 'dark'
                              ? 'bg-[#121214] border-zinc-800 text-zinc-300 focus:ring-blue-800 focus:border-blue-800'
                              : 'bg-white border-zinc-200 text-zinc-700 focus:ring-blue-105/35 focus:border-blue-105/35'
                          }`}
                          onChange={(e) => {
                            const selectedId = e.target.value;
                            if (!selectedId) return;
                            const selectedLog = logs.find(l => l.id === selectedId);
                            if (selectedLog) {
                               const origText = selectedLog.originalCopyText || '';
                               const aiText = selectedLog.aiCorrectedText || origText;
                               const draftText = selectedLog.currentDraftText || origText;
                               setCopy(origText);
                               setCopyHtml(generateParagraphHtml(origText));
                               setOriginalCopy(origText);
                               setOriginalCopyHtml(generateParagraphHtml(origText));
                               setCurrentDraft(draftText);
                               setCurrentDraftHtml(generateParagraphHtml(draftText));
                               setAiCorrectedText(aiText);
                               
                               // Restore issues exactly as they were saved so the session state is preserved.
                               const parsedIssues = selectedLog.suggestions || parseSuggestionsFromMarkdown(selectedLog.reportMarkdown);
                               setIssues(parsedIssues);
                               
                               setCustomLogName(selectedLog.logName || '');
                               setActiveLogId(selectedLog.id);
                               setEditMode(false);
                               setShowCrossCheck(false);
                            }
                            // Reset select after choosing
                            e.target.value = "";
                          }}
                        >
                          <option value="">Select previous session...</option>
                          {logs.map(log => {
                             let dateStr = 'Unknown Date';
                             if (log.timestamp) {
                               const d = new Date(log.timestamp);
                               dateStr = isNaN(d.getTime()) 
                                 ? log.timestamp 
                                 : d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                             }
                             const titleStr = log.logName || log.draftSummary || `Session ${log.id.slice(0,4)}`;
                             return (
                               <option key={log.id} value={log.id}>
                                 {dateStr} - {titleStr}
                               </option>
                             );
                          })}
                        </select>
                      </div>
                    )}
                  </div>

                  {!showCrossCheck && (
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-3">
                        {copy && (
                          <button 
                            onClick={() => setCopy('')}
                            className={`text-xs font-mono font-bold uppercase px-3.5 py-2.5 border rounded-lg transition-all cursor-pointer ${
                              theme === 'dark'
                                ? 'border-zinc-850 bg-[#121214] text-red-400 hover:bg-red-950/20'
                                : 'border-zinc-200 bg-white text-red-650 hover:bg-red-50'
                            }`}
                          >
                            Clear Draft
                          </button>
                        )}
                        
                        <button
                          onClick={() => handleReview()}
                          disabled={loading || !copy.trim()}
                          className={`px-5 py-2.5 rounded-lg border text-xs font-bold uppercase tracking-[0.15em] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm relative overflow-hidden ${
                            theme === 'dark'
                              ? 'border-zinc-750 bg-blue-600 text-white hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-400 disabled:border-zinc-800'
                              : 'border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-850 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:border-zinc-200'
                          } ${
                            loading || !copy.trim()
                              ? 'opacity-80 cursor-not-allowed'
                              : 'active:translate-y-0.5'
                          }`}
                        >
                          <AnimatePresence mode="wait">
                            {loading ? (
                              <motion.div
                                key={loadingStage}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                                className="flex items-center gap-2 absolute"
                              >
                                {loadingStage === 'consistency' ? (
                                  <Sparkles className={`w-4 h-4 animate-pulse ${theme === 'dark' ? 'text-yellow-300' : 'text-amber-500'}`} />
                                ) : loadingStage === 'dictionary' ? (
                                  <FileText className={`w-4 h-4 animate-pulse ${theme === 'dark' ? 'text-blue-300' : 'text-blue-500'}`} />
                                ) : (
                                  <Search className="w-4 h-4 animate-spin" />
                                )}
                                <span>{loadingStage === 'style' ? 'Checking Style...' : loadingStage === 'consistency' ? 'Checking Context...' : loadingStage === 'dictionary' ? 'Checking Dictionary...' : 'Analysing Copy...'}</span>
                              </motion.div>
                            ) : (
                              <motion.div
                                key="idle"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                                className="flex items-center gap-2 absolute"
                              >
                                <PenTool className="w-4 h-4" />
                                <span>Launch Style Check</span>
                              </motion.div>
                            )}
                          </AnimatePresence>
                          {/* Invisible placeholder to maintain consistent button width during absolute positioning */}
                          <div className="flex items-center gap-2 opacity-0 pointer-events-none"> 
                             <Search className="w-4 h-4" />
                             <span>Checking Context...</span>
                          </div>
                        </button>
                      </div>

                      <div className="flex items-center gap-4">
                        {userRole !== 'editor' && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setEnableThinkingMode(!enableThinkingMode)}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                                enableThinkingMode 
                                  ? (theme === 'dark' ? 'bg-purple-500' : 'bg-purple-600') 
                                  : (theme === 'dark' ? 'bg-zinc-700' : 'bg-zinc-300')
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                  enableThinkingMode ? 'translate-x-4' : 'translate-x-1'
                                }`}
                              />
                            </button>
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>
                              Thinking Mode
                            </span>
                          </div>
                        )}
                        
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEnableSocialMediaGuidelines(!enableSocialMediaGuidelines)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                              enableSocialMediaGuidelines 
                                ? (theme === 'dark' ? 'bg-blue-500' : 'bg-blue-600') 
                                : (theme === 'dark' ? 'bg-zinc-700' : 'bg-zinc-300')
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                enableSocialMediaGuidelines ? 'translate-x-4' : 'translate-x-1'
                              }`}
                            />
                          </button>
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>
                            Socials Guidelines
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {showCrossCheck ? (
                  <div className="flex-grow flex flex-col overflow-y-auto px-1 pb-16">
                    {renderSubEditorAuditPanel()}
                  </div>
                ) : (
                  <>
                    {/* Custom Log Name Input Field */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 font-mono">
                        Name of this Editorial Log (Optional)
                      </label>
                      <input
                        type="text"
                        value={customLogName}
                        onChange={(e) => setCustomLogName(e.target.value)}
                        placeholder="Provide a story title or unique test log name"
                        className={`px-4 py-2.5 rounded-lg text-xs font-semibold border focus:outline-none focus:ring-1 transition-all ${
                          theme === 'dark'
                            ? 'bg-[#121214] border-zinc-800 text-zinc-150 placeholder-zinc-600 focus:ring-blue-800 focus:border-blue-800'
                            : 'bg-white border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:ring-blue-105/35 focus:border-blue-105/35'
                        }`}
                      />
                    </div>

                    {/* Substantially Enlarged Writing Canvas */}
                    <div className={`relative flex flex-col flex-1 rounded-xl shadow-sm border p-6 lg:p-8 transition-all overflow-hidden ${
                      theme === 'dark' 
                        ? 'bg-[#121214] border-zinc-800/80' 
                        : 'bg-white border-zinc-200/90'
                    }`}>
                      <div
                        ref={inputEditorRef}
                        contentEditable
                        onInput={handleInputEditorChange}
                        onPaste={handleInputEditorPaste}
                        className={`editorial-canvas w-full h-full flex-grow bg-transparent border-none focus:outline-none font-serif text-[18px] lg:text-[20px] leading-relaxed overflow-y-auto pb-14 outline-none select-text ${
                          theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'
                        }`}
                        spellCheck={false}
                      />
                      {!copy && (
                        <div className="absolute top-6 lg:top-8 left-6 lg:left-8 right-6 lg:right-8 font-serif text-[18px] lg:text-[20px] leading-relaxed text-zinc-400 pointer-events-none select-none">
                          Type or paste your drafts here
                        </div>
                      )}
                      
                      {/* Bottom info bar within the writing deck */}
                      <div className={`absolute bottom-4 left-6 lg:left-8 right-6 lg:right-8 flex items-center justify-between pt-4 border-t ${
                        theme === 'dark' ? 'border-zinc-800/60' : 'border-zinc-100/60'
                      }`}>
               
                        <span className={`text-[10px] md:text-xs font-mono font-semibold ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-400'}`}>
                          {copy.trim().length === 0 ? '0' : copy.trim().split(/\s+/).length} words
                        </span>
                      </div>
                    </div>

                    {error && (
                      <div className={`p-5 text-xs md:text-sm flex flex-col gap-3 rounded-md shadow-sm border shrink-0 ${
                        theme === 'dark'
                          ? 'bg-red-950/20 border-red-900/40 text-red-200'
                          : 'bg-red-50 border-red-200 text-red-950'
                      }`}>
                        <div className="flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 shrink-0 text-red-650 mt-0.5" />
                          <div className="space-y-1">
                            <span className={`font-bold block uppercase tracking-wide ${theme === 'dark' ? 'text-red-400' : 'text-red-950'}`}>Analysis Incomplete</span>
                            <p className={`font-medium leading-relaxed ${theme === 'dark' ? 'text-red-350' : 'text-red-800'}`}>{error}</p>
                          </div>
                        </div>
                        {/api_key|api key|key not found|invalid/i.test(error) && (
                          <div className={`mt-2 pt-3 border-t text-xs space-y-2 ${
                            theme === 'dark' ? 'border-red-900/30 text-zinc-400' : 'border-red-200/60 text-stone-600'
                          }`}>
                            <p className="font-bold flex items-center gap-1.5 uppercase tracking-tight text-[11px]">
                              <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" /> API Configuration Advisory
                            </p>
                            <p className="leading-relaxed text-[11px] md:text-xs text-zinc-400">
                              We've configured your app's Gemini API calls to run securely on the server. Your API key can be found and updated in the <strong className={theme === 'dark' ? 'text-zinc-200 font-semibold' : 'text-black font-semibold'}>Settings &gt; Secrets</strong> panel of your workspace. 
                            </p>
                            <p className="leading-relaxed text-[11px] md:text-xs text-zinc-500">
                              Please ensure that a valid, active Gemini API Key is saved there.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          ) : (
            /* Review & Correction Board View */
            <motion.div 
              key="board-screen"
              className="absolute inset-0 flex flex-row overflow-hidden"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Left Column: Interactive Suggestion Deck Panel */}
              {!showCrossCheck && (
                <section className={`w-[290px] sm:w-[350px] md:w-[420px] ${currentTheme.sidebarBorder} flex flex-col ${theme === 'dark' ? 'bg-[#141417]' : 'bg-white'} overflow-hidden shrink-0 transition-all`}>
                <div className={`${currentTheme.sidebarHeader} transition-all flex flex-col items-start gap-1 pb-2.5`}>
                  <div className="w-full flex items-center justify-between">
                    <h2 className="text-xs font-bold tracking-[0.1em] uppercase m-0 flex items-center gap-2">
                      <Layout className="w-3.5 h-3.5" /> Issues Found ({stats.pending} left)
                    </h2>
                    <button 
                      onClick={() => { setIssues([]); setOriginalCopy(''); setCopy(''); setCustomLogName(''); }}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all border shadow-sm flex items-center gap-1.5 ${
                        theme === 'dark' 
                          ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500 hover:text-white hover:border-blue-400' 
                          : 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700 hover:text-white hover:border-blue-700'
                      }`}
                    >
                      <ArrowLeft className="w-3 h-3" /> New Review
                    </button>
                  </div>
                  {customLogName.trim() && (
                    <div className="w-full text-[10px] font-mono mt-1 text-zinc-400 select-none pb-1 truncate border-b border-zinc-800/10 dark:border-zinc-800/20">
                      Log Name: <span className="text-[#0055FF] dark:text-blue-400 font-extrabold">{customLogName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider ${
                      theme === 'dark'
                        ? 'bg-zinc-855 text-zinc-300 border border-zinc-750'
                        : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                    }`}>
                      Mode: Standard Editorial
                    </span>
                  </div>
                </div>

                {/* Substats dashboard header */}
                <div className={`p-4 shrink-0 grid grid-cols-3 text-center text-xs font-mono uppercase tracking-widest border-b ${
                  theme === 'dark' ? 'bg-[#0E0E10] border-zinc-800 text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-650'
                }`}>
                  <div className={`border-r ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
                    <span className="block text-emerald-600 font-bold text-base leading-none mb-1">
                      {issues.filter(i => i.status === 'accepted').length}
                    </span>
                    <span className="text-[9px] text-zinc-400">Accepted</span>
                  </div>
                  <div className={`border-r ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
                    <span className="block text-red-550 font-bold text-base leading-none mb-1">
                      {issues.filter(i => i.status === 'pending').length}
                    </span>
                    <span className="text-[9px] text-zinc-400">Pending</span>
                  </div>
                  <div>
                    <span className="block text-zinc-500 font-bold text-base leading-none mb-1">
                      {issues.filter(i => i.status === 'rejected').length}
                    </span>
                    <span className="text-[9px] text-zinc-400">Ignored</span>
                  </div>
                </div>

                {/* Review Stage Filtering Tabs */}
                <div className={`px-4 py-2 shrink-0 flex gap-1 border-b overflow-x-auto no-scrollbar ${
                  theme === 'dark' ? 'bg-[#121214] border-zinc-800' : 'bg-white border-zinc-200'
                }`}>
                  <button
                    onClick={() => setSelectedReviewFilter('all')}
                    className={`px-2.5 py-1 text-[9px] font-mono uppercase font-bold rounded cursor-pointer transition-all ${
                      selectedReviewFilter === 'all'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : theme === 'dark'
                          ? 'text-zinc-450 hover:bg-zinc-800 hover:text-zinc-200 bg-zinc-900/50'
                          : 'text-zinc-650 hover:bg-zinc-100 bg-zinc-50 border border-zinc-200/60'
                    }`}
                  >
                    All ({issues.length})
                  </button>
                  <button
                    onClick={() => setSelectedReviewFilter('style')}
                    className={`px-2.5 py-1 text-[9px] font-mono uppercase font-bold rounded cursor-pointer transition-all ${
                      selectedReviewFilter === 'style'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : theme === 'dark'
                          ? 'text-zinc-450 hover:bg-zinc-800 hover:text-zinc-200 bg-zinc-900/50'
                          : 'text-zinc-650 hover:bg-zinc-100 bg-zinc-50 border border-zinc-200/60'
                    }`}
                  >
                    Style ({issues.filter(i => i.type === 'style').length})
                  </button>
                  <button
                    onClick={() => setSelectedReviewFilter('consistency')}
                    className={`px-2.5 py-1 text-[9px] font-mono uppercase font-bold rounded cursor-pointer transition-all ${
                      selectedReviewFilter === 'consistency'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : theme === 'dark'
                          ? 'text-zinc-450 hover:bg-zinc-800 hover:text-zinc-200 bg-zinc-900/50'
                          : 'text-zinc-650 hover:bg-zinc-100 bg-zinc-50 border border-zinc-200/60'
                    }`}
                  >
                    Context ({issues.filter(i => i.type === 'consistency').length})
                  </button>
                  <button
                    onClick={() => setSelectedReviewFilter('dictionary')}
                    className={`px-2.5 py-1 text-[9px] font-mono uppercase font-bold rounded cursor-pointer transition-all ${
                      selectedReviewFilter === 'dictionary'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : theme === 'dark'
                          ? 'text-zinc-450 hover:bg-zinc-800 hover:text-zinc-200 bg-zinc-900/50'
                          : 'text-zinc-650 hover:bg-zinc-100 bg-zinc-50 border border-zinc-200/60'
                    }`}
                  >
                    Dict ({issues.filter(i => i.type === 'dictionary').length})
                  </button>
                </div>

                {/* List Container */}
                <div className={`flex-grow p-4 lg:p-6 overflow-y-auto space-y-4 custom-scrollbar ${
                  theme === 'dark' ? 'bg-[#0E0E10]' : 'bg-zinc-50/50'
                }`}>
                  {issues.length === 0 ? (
                    <div className={`h-full flex flex-col justify-center items-center text-center py-12 px-6 border border-dashed rounded ${
                      theme === 'dark'
                        ? 'bg-zinc-900/60 border-zinc-800 text-zinc-400'
                        : 'bg-white border-gray-300 text-gray-500'
                    }`}>
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                      <p className={`font-semibold text-sm ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-700'}`}>Perfect!</p>
                      <p className="text-xs mt-1 uppercase tracking-wider">No deviations from the Broadsheet style guide detected. Solid copy.</p>
                    </div>
                  ) : (
                    <>
                      {issues.length > 0 && stats.pending === 0 && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`p-5 mb-4 border rounded-lg text-center ${
                            theme === 'dark' ? 'bg-[#18181F] border-emerald-900/30' : 'bg-emerald-50/70 border-emerald-200 text-zinc-900 shadow-sm'
                          }`}
                        >
                          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                          <h3 className="font-bold uppercase tracking-wider text-xs font-sans">Review Completed!</h3>
                          <p className={`text-[11px] mt-1 leading-normal max-w-sm mx-auto ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-650'}`}>
                            All flagged style guide suggestions have been resolved or ignored.
                          </p>
                          <button
                            onClick={() => setShowReportModal(true)}
                            className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase font-bold tracking-wider rounded select-none cursor-pointer transition-all ${
                              theme === 'dark'
                                    ? 'bg-emerald-600 hover:bg-emerald-505 text-white'
                                    : 'bg-[#0055FF] text-white hover:bg-zinc-950 shadow-sm'
                            }`}
                          >
                            <FileText className="w-3.5 h-3.5" /> View Refinement Report
                          </button>
                        </motion.div>
                      )}
                      
                      {/* Auto-Apply All Suggestions button has been removed as requested */}
                      
                      {(() => {
                        // Gather issues with their original indices and filter them by the active tab
                        const filtered = issues
                          .map((issue, originalIndex) => ({ ...issue, originalIndex }))
                          .filter((issue) => {
                            if (selectedReviewFilter === 'all') return true;
                            if (selectedReviewFilter === 'style') return issue.type === 'style';
                            if (selectedReviewFilter === 'consistency') return issue.type === 'consistency';
                            if (selectedReviewFilter === 'dictionary') return issue.type === 'dictionary';
                            return true;
                          });

                        if (filtered.length === 0) {
                          return (
                            <div className={`p-6 border border-dashed rounded text-center uppercase tracking-widest text-[10px] font-mono font-bold py-12 ${
                              theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800 text-zinc-500' : 'bg-white border-zinc-200 text-zinc-400'
                            }`}>
                              No pending {selectedReviewFilter} issues found in this category.
                            </div>
                          );
                        }

                        return filtered.map((issue) => {
                          const originalIdx = issue.originalIndex;
                          const isSelected = selectedIssueIndex === originalIdx;
                          const isPending = issue.status === 'pending';
                          const isAccepted = issue.status === 'accepted';
                          const isRejected = issue.status === 'rejected';

                          // Sidebar card style based on theme
                          const bgCard = theme === 'dark' ? 'bg-[#18181b] border-zinc-800/80' : 'bg-white border-zinc-200/80';
                          const ringCard = isSelected 
                            ? theme === 'dark' 
                              ? 'ring-2 ring-zinc-500 shadow-xl translate-x-1.5' 
                              : 'ring-2 ring-zinc-950 shadow-xl translate-x-1.5' 
                            : 'shadow-sm';

                          let borderClass = 'border-l-4 border-gray-300';
                          if (isPending) {
                            borderClass = issue.isNote ? 'border-l-4 border-amber-500' : 'border-l-4 border-red-500';
                          } else if (isAccepted) {
                            borderClass = theme === 'dark' ? 'border-l-4 border-emerald-500 bg-emerald-950/10' : 'border-l-4 border-emerald-600 bg-emerald-50/20';
                          }

                          const badgeRule = theme === 'dark' ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-950 text-white';
                          const badgeAdvisory = theme === 'dark' ? 'bg-amber-950/80 text-amber-200 border-amber-900' : 'bg-amber-100 text-amber-800 border-amber-200';
                          
                          const fontTextClass = theme === 'dark' ? 'text-zinc-400' : 'text-zinc-700';
                          const searchFrameBg = theme === 'dark' ? 'bg-zinc-900/60 border-zinc-800/40' : 'bg-[#FAF9F6] border-zinc-100';
                          const correctionFrameBg = theme === 'dark' ? 'bg-indigo-950/20 border-indigo-900/30' : 'bg-blue-50/40 border-blue-50';
                          const correctionText = theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900';
                          const primaryCorrectionUnderline = theme === 'dark' ? 'decoration-blue-500' : 'decoration-blue-600';

                          return (
                            <div
                              key={originalIdx}
                              ref={(el) => { issueRefs.current[originalIdx] = el; }}
                              onClick={() => setSelectedIssueIndex(originalIdx)}
                              className={`relative p-5 transition-all outline-none cursor-pointer border rounded ${bgCard} ${ringCard} ${borderClass}`}
                            >
                              <div className="flex justify-between items-start gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                                    issue.type === 'consistency' 
                                      ? (theme === 'dark' ? 'bg-indigo-900/60 text-indigo-300' : 'bg-indigo-100 text-indigo-800') 
                                      : issue.type === 'dictionary'
                                        ? (theme === 'dark' ? 'bg-amber-950/60 text-amber-300' : 'bg-amber-100 text-amber-800')
                                        : badgeRule
                                  }`}>
                                    {issue.type === 'consistency' ? 'CONTEXT' : issue.type === 'dictionary' ? 'DICTIONARY' : 'STYLE'}: {issue.rule}
                                  </span>
                                </div>
                                {issue.isNote && (
                                  <span className={`text-[9px] font-mono font-bold border px-1.5 py-0.5 rounded uppercase ${badgeAdvisory}`}>
                                    Advisory
                                  </span>
                                )}
                                {!isPending && (
                                  <span className={`text-[10px] font-mono font-bold uppercase ${isAccepted ? 'text-emerald-500' : 'text-gray-400'}`}>
                                    {isAccepted ? 'Applied' : 'Ignored'}
                                  </span>
                                )}
                              </div>

                              <div className="space-y-2 mt-2">
                                {/* Fragment display showing exact text */}
                                <div className={`p-2 border rounded text-xs leading-relaxed ${searchFrameBg}`}>
                                  <span className="text-[10px] block text-zinc-400 uppercase font-mono mb-1">Found Text:</span>
                                  <span className={`font-serif italic ${fontTextClass}`}>"{issue.original}"</span>
                                </div>

                                {/* Detail text */}
                                <p className={`text-xs leading-relaxed mt-1 ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-650'}`}>
                                  {issue.issue}
                                </p>

                                {/* Proposed change indicator */}
                                <div className={`p-2 border rounded text-xs leading-relaxed ${correctionFrameBg}`}>
                                  <span className={`text-[10px] block uppercase font-mono mb-1 ${theme === 'dark' ? 'text-indigo-400' : 'text-[#0055FF]'}`}>
                                    {issue.isNote || !issue.fix || isAdvisoryInstruction(issue.fix) ? "Advisory Guidance:" : "Suggestion:"}
                                  </span>
                                  <span className={`font-serif font-bold ${correctionText} ${!issue.isNote && issue.fix && !isAdvisoryInstruction(issue.fix) ? `underline ${primaryCorrectionUnderline}` : 'italic text-zinc-400'}`}>
                                    {issue.isNote || !issue.fix || isAdvisoryInstruction(issue.fix) ? "(Review manually - no direct text replacement)" : issue.fix}
                                  </span>
                                </div>

                                {/* Status Buttons Actions */}
                                {isPending ? (
                                  <div className={`grid grid-cols-2 gap-2 pt-3 border-t mt-3 ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAccept(originalIdx); }}
                                      className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-mono uppercase font-bold text-center flex items-center justify-center gap-1 transition-all cursor-pointer rounded"
                                    >
                                      <Check className="w-3.5 h-3.5" /> {issue.isNote || !issue.fix || isAdvisoryInstruction(issue.fix) ? "Acknowledge" : "Apply"}
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleReject(originalIdx); }}
                                      className={`py-1.5 px-3 text-[11px] font-mono uppercase font-bold text-center flex items-center justify-center gap-1 transition-all cursor-pointer rounded ${
                                        theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
                                      }`}
                                    >
                                      <X className="w-3.5 h-3.5" /> Ignore
                                    </button>
                                  </div>
                                ) : (
                                  <div className={`pt-2 border-t flex justify-end ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleUndo(originalIdx); }}
                                      className={`py-1 px-2 text-[10px] uppercase font-mono font-bold flex items-center gap-1 transition-all cursor-pointer hover:bg-zinc-100/10 rounded ${
                                        theme === 'dark' ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900'
                                      }`}
                                    >
                                      <Undo2 className="w-3 h-3" /> Revert
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </>
                  )}
                </div>
              </section>
              )}

              {/* Right Column: Live Document Editing Canvas Workspace */}
              <section className={`flex-1 flex flex-col overflow-hidden ${currentTheme.stageBg}`}>
                
                {/* Dashboard Options Toolbar */}
                <div className={`${currentTheme.workspaceToolbar} border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200/20'} transition-all`}>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-4 shrink-0">
                    <h2 className="text-xs font-bold tracking-[0.1em] uppercase m-0 flex items-center gap-1.5 shrink-0">
                      <Layout className="w-3.5 h-3.5 text-blue-500" />
                      <span className="hidden sm:inline">Workspace Mode:</span>
                    </h2>
                    
                    {/* 3-Tab Segment Switcher */}
                    <div className="flex bg-[#0c0c0e] border border-zinc-800 rounded p-0.5 gap-0.5 select-none shrink-0">
                      <button
                        onClick={() => { setEditMode(false); setShowCrossCheck(false); }}
                        className={`text-[10px] uppercase font-bold px-2 py-1 sm:px-2.5 rounded cursor-pointer transition-all ${
                          !editMode && !showCrossCheck
                            ? 'bg-blue-600 text-white font-extrabold'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-805'
                        }`}
                      >
                        Highlight Review
                      </button>
                      <button
                        onClick={() => { setEditMode(true); setShowCrossCheck(false); }}
                        className={`text-[10px] uppercase font-bold px-2 py-1 sm:px-2.5 rounded cursor-pointer transition-all ${
                          editMode && !showCrossCheck
                            ? 'bg-blue-600 text-white font-extrabold'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-805'
                        }`}
                      >
                        Manual Editor
                      </button>
                      <button
                        onClick={() => { setEditMode(false); setShowCrossCheck(true); }}
                        className={`text-[10px] uppercase font-bold px-2 py-1 sm:px-2.5 rounded cursor-pointer transition-all flex items-center gap-1 ${
                          showCrossCheck
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-extrabold'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-805'
                        }`}
                      >
                        <Sparkles className="w-3 h-3 text-amber-400" />
                        Sub-Editor Audit
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 shrink-0">
                    <button 
                      onClick={copyToClipboard}
                      className={`text-[10px] uppercase font-bold border px-2.5 py-1 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer rounded ${
                        theme === 'dark'
                          ? 'border-zinc-700 hover:bg-zinc-800 text-zinc-100'
                          : 'border-white/40 hover:bg-white hover:text-black text-white'
                      }`}
                    >
                      {isCopied ? (
                        <>
                          <ClipboardCheck className={`w-3 h-3 ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-350'}`} /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Export Clean Text
                        </>
                      )}
                    </button>
                    
                    <button 
                      onClick={copyOriginalToClipboard}
                      className={`text-[10px] uppercase font-semibold cursor-pointer py-1 px-2.5 rounded transition-all ${
                        theme === 'dark'
                          ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                          : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {isOriginalCopied ? "Original Copied!" : "Copy Original"}
                    </button>

                    {issues.length > 0 && (
                      <button 
                        onClick={() => setShowReportModal(true)}
                        className={`text-[10px] font-bold uppercase border px-2.5 py-1 flex items-center gap-1.5 transition-all select-none cursor-pointer rounded ${
                          theme === 'dark'
                            ? 'border-blue-900 bg-blue-950/20 hover:bg-blue-950/40 text-blue-400'
                            : 'border-[#0055FF]/40 bg-[#0055FF]/10 text-[#0055FF] hover:bg-[#0055FF] hover:text-white'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" /> Test Report
                      </button>
                    )}
                  </div>
                </div>

                {/* Main Paper Content Stage */}
                <div className="flex-grow p-5 lg:p-12 overflow-y-auto flex flex-col items-center">
                  
                  {showCrossCheck ? (
                    /* Human-AI Cross-Check Workspace Panel */
                    <div className="w-full max-w-4xl flex flex-col gap-6 animate-fadeIn pb-16">
                      
                      {/* Analysis Results Display */}
                      {crossCheckAnalysis ? (
                        <div className="flex flex-col gap-6">
                          
                          {/* Score and Gap Overview Block */}
                          <div className={`p-6 rounded-xl border grid grid-cols-1 md:grid-cols-12 gap-6 items-center ${
                            theme === 'dark' ? 'bg-gradient-to-r from-zinc-900 to-[#121215] border-zinc-800 text-zinc-100' : 'bg-gradient-to-r from-zinc-50 to-white border-zinc-200 text-zinc-900 shadow-sm'
                          }`}>
                            {/* Dial Column */}
                            <div className="col-span-1 md:col-span-4 flex flex-col items-center justify-center text-center py-2 border-r border-zinc-800/10 dark:border-zinc-800 md:pr-6">
                              <span className="text-[10px] uppercase font-bold text-zinc-400 mb-2">Editor Alignment Score</span>
                              <div className="relative flex items-center justify-center">
                                <svg className="w-28 h-28 transform -rotate-90">
                                  <circle cx="56" cy="56" r="46" stroke={theme === 'dark' ? '#18181c' : '#f4f4f5'} strokeWidth="8" fill="transparent" />
                                  <circle cx="56" cy="56" r="46" stroke="#0055ff" strokeWidth="8" fill="transparent"
                                          strokeDasharray={2 * Math.PI * 46}
                                          strokeDashoffset={2 * Math.PI * 46 * (1 - crossCheckAnalysis.accuracyScore / 100)}
                                          strokeLinecap="round"
                                          className="transition-all duration-1000 ease-out" />
                                </svg>
                                <span className="absolute text-3xl font-black tracking-tighter">
                                  {crossCheckAnalysis.accuracyScore}%
                                </span>
                              </div>
                              <span className="text-[9px] font-mono uppercase bg-blue-605/10 text-blue-500 font-bold px-2 py-0.5 rounded-full mt-3">
                                {crossCheckAnalysis.accuracyScore >= 90 ? 'Gold Standard' : crossCheckAnalysis.accuracyScore >= 75 ? 'Strong Alignment' : 'Needs Fine-Tuning'}
                              </span>
                            </div>

                            {/* Evaluation Statement Column */}
                            <div className="col-span-1 md:col-span-8 space-y-3">
                              <span className="text-[10px] uppercase font-bold text-zinc-400 font-mono block">Accuracy Gap Assessment</span>
                              <h4 className="text-xl font-bold tracking-tight m-0 normal-case leading-snug">
                                {crossCheckAnalysis.alignmentGap}
                              </h4>
                              <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-650'}`}>
                                {crossCheckAnalysis.fineTuningActionable}
                              </p>
                              <div className="flex gap-2.5 pt-1">
                                <button
                                  onClick={() => { setCrossCheckAnalysis(null); }}
                                  className={`px-3 py-1.5 text-[10px] font-bold uppercase border rounded-lg transition-all cursor-pointer ${
                                    theme === 'dark' ? 'border-zinc-750 bg-zinc-900 hover:bg-zinc-800 text-zinc-300' : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700'
                                  }`}
                                >
                                  Re-run Analysis
                                </button>
                                <button
                                  onClick={() => {
                                    const text = `# AI ERROR GAP REPORT\n\n- Alignment Score: ${crossCheckAnalysis.accuracyScore}%\n- Summary: ${crossCheckAnalysis.alignmentGap}\n\n## Missed Infractions:\n` + 
                                      crossCheckAnalysis.missedInfractions.map((i, index) => 
                                        `### [Gap #${index + 1}] Rule: ${i.rule}\n- Original: "${i.original}"\n- Human corrected: "${i.human}"\n- AI draft: "${i.ai}"\n- Explanation: ${i.explanation}\n- Patch recommended: ${i.fineTuningPatch} (Target register: ${i.targetGuide})\n`
                                      ).join('\n');
                                    navigator.clipboard.writeText(text);
                                    alert("Gap Report copied to clipboard as Markdown!");
                                  }}
                                  className="px-3 py-1.5 text-[10px] font-bold uppercase bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-lg transition-all cursor-pointer"
                                >
                                  Export Gap Report
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Gaps detected list */}
                          <div className="space-y-4">
                            <h3 className="text-xs font-bold tracking-[0.1em] uppercase m-0 flex items-center gap-1.5">
                              <AlertCircle className="w-4 h-4 text-amber-500" /> Missed Style Violations & Typo Gaps ({crossCheckAnalysis.missedInfractions.length})
                            </h3>

                            {crossCheckAnalysis.missedInfractions.length === 0 ? (
                              <div className={`p-8 text-center rounded-xl border border-dashed text-xs uppercase tracking-wider ${
                                theme === 'dark' ? 'bg-[#18181f]/30 border-zinc-800 text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                              }`}>
                                Complete alignment! The AI copy-editor caught 100% of the style guide corrections that you did. No missing infractions found.
                              </div>
                            ) : (
                              crossCheckAnalysis.missedInfractions.map((item, idx) => {
                                const isSaving = guidePatchesSaving[idx];
                                const progressMsg = guidePatchesProgress[idx];
                                const pathColor = item.targetGuide === 'dictionary' ? 'text-amber-400 border-amber-500/25 bg-amber-500/5' :
                                                  item.targetGuide === 'banned' ? 'text-red-400 border-red-500/25 bg-red-500/5' :
                                                  item.targetGuide === 'mistakes' ? 'text-purple-400 border-purple-500/25 bg-purple-500/5' :
                                                  'text-blue-400 border-blue-500/25 bg-blue-500/5';

                                return (
                                  <div key={idx} className={`p-5 rounded-xl border flex flex-col gap-4 relative transition-all ${
                                    theme === 'dark' ? 'bg-[#141417] border-zinc-800' : 'bg-white border-zinc-200 shadow-sm'
                                  }`}>
                                    {/* Header info */}
                                    <div className="flex justify-between items-center pb-2 border-b border-zinc-250/10">
                                      <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 bg-amber-600 text-white rounded text-[8px] font-mono font-bold uppercase">MISS # {idx + 1}</span>
                                        <span className="text-[10px] font-mono font-bold text-zinc-400">{item.rule}</span>
                                      </div>
                                      <span className={`px-2 py-0.5 border text-[9px] font-mono font-bold uppercase rounded ${pathColor}`}>
                                        register: {item.targetGuide}
                                      </span>
                                    </div>

                                    {/* Compares box */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
                                      <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                                        theme === 'dark' ? 'bg-[#0e0e11] border-zinc-800' : 'bg-zinc-50/60 border-zinc-100'
                                      }`}>
                                        <span className="text-[9px] font-bold text-zinc-400 uppercase">Original Copy:</span>
                                        <span className="font-serif italic text-[14px] line-through decoration-red-500/50">"{item.original}"</span>
                                      </div>
                                      <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                                        theme === 'dark' ? 'bg-[#0e0e11] border-zinc-800' : 'bg-zinc-50/65 border-zinc-100'
                                      }`}>
                                        <span className="text-[9px] font-bold text-zinc-500 uppercase">AI Copy Draft:</span>
                                        <span className="font-serif italic text-[14px] text-zinc-400">"{item.ai || '(Unchanged)'}"</span>
                                      </div>
                                      <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                                        theme === 'dark' ? 'bg-emerald-950/10 border-emerald-900/40' : 'bg-emerald-50/40 border-emerald-100'
                                      }`}>
                                        <span className="text-[9px] font-bold text-emerald-500 uppercase">Human Finalized:</span>
                                        <span className="font-serif font-black text-[14px] text-emerald-600 dark:text-emerald-400">"{item.human}"</span>
                                      </div>
                                    </div>

                                    {/* Detailed explanation */}
                                    <div className="text-xs leading-relaxed">
                                      <span className="font-bold block text-zinc-400 font-mono text-[9px] uppercase mb-1">Gap Analysis:</span>
                                      <p className={theme === 'dark' ? 'text-zinc-300 italic font-serif' : 'text-zinc-700 italic font-serif'}>
                                        {item.explanation}
                                      </p>
                                    </div>

                                    {/* Actionable fine-tuning patch box */}
                                    <div className={`p-4 rounded-lg border ${
                                      theme === 'dark' ? 'bg-[#0f0f12] border-zinc-850' : 'bg-zinc-50 border-zinc-200/85'
                                    }`}>
                                      <div className="space-y-1.5">
                                        <span className="text-[9px] uppercase font-bold text-blue-500 font-mono block">Recommended Fine-Tuning Register Patch</span>
                                        <code className="text-xs font-mono font-medium bg-[#070709] text-zinc-300 dark:text-zinc-200 p-2.5 rounded block w-full break-words whitespace-pre-wrap border border-zinc-800/40 select-all leading-relaxed">
                                          {item.fineTuningPatch}
                                        </code>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      ) : (
                        /* Paste and Analyze Workspace */
                        <div className="flex flex-col gap-6">

                          {/* 1. Log Selector Section */}
                          <div className={`p-5 rounded-xl border flex flex-col gap-3 ${
                            theme === 'dark' ? 'bg-[#141417] border-zinc-800' : 'bg-white border-zinc-200 shadow-sm'
                          }`}>
                            <span className="text-[10px] uppercase font-bold text-zinc-400 font-mono flex items-center gap-1.5">
                              <History className="w-3.5 h-3.5 text-blue-500 animate-pulse shrink-0" />
                              SELECT SHARED SESSION LOG TO AUDIT (TESTING & SUB-EDITOR AUDIT)
                            </span>
                            <p className="text-[11px] text-zinc-500 leading-normal m-0 font-medium">
                              Choose a saved compliance reviewed session log from the database. This automatically populates the original draft copy, the AI's standard suggested corrections, and your finalized manually sub-edited copy!
                            </p>

                            {auditableLogs.length === 0 ? (
                              <div className={`mt-2 p-4 rounded-lg border border-dashed text-xs text-center flex flex-col items-center justify-center gap-1.5 ${
                                theme === 'dark' ? 'bg-zinc-900/30 border-zinc-800 text-zinc-400' : 'bg-zinc-50 border-zinc-205 text-zinc-550'
                              }`}>
                                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                                <span className="font-bold uppercase tracking-wider text-[10px]">No past review sessions found</span>
                                <p className="m-0 text-[11px] leading-relaxed max-w-md">
                                  You haven't run any compliance style checks yet in this session. Run a <strong className="text-blue-500">"New Style Check"</strong> first, and that workspace will immediately be logged here for human comparison evaluation!
                                </p>
                              </div>
                            ) : (
                              <>
                                {/* Real-time search filter query */}
                                <div className="flex flex-col sm:flex-row gap-2 mt-1">
                                  <div className="relative flex-grow">
                                    <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-400" />
                                    <input
                                      type="text"
                                      value={auditLogSearchQuery}
                                      onChange={(e) => setAuditLogSearchQuery(e.target.value)}
                                      placeholder="Search saved logs by title, draft keyword, or date..."
                                      className={`w-full pl-9 pr-3 py-2 rounded-lg text-xs font-semibold border focus:outline-none transition-all ${
                                        theme === 'dark'
                                          ? 'bg-[#121214] border-zinc-800 text-zinc-200 focus:border-blue-800'
                                          : 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:focus:border-blue-300'
                                      }`}
                                    />
                                  </div>
                                  {auditLogSearchQuery && (
                                    <button
                                      onClick={() => setAuditLogSearchQuery('')}
                                      className={`px-3 py-2 rounded-lg text-xs font-bold uppercase transition-all border cursor-pointer shrink-0 ${
                                        theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400' : 'border-zinc-200 hover:bg-zinc-50 text-zinc-650'
                                      }`}
                                    >
                                      Clear Filter
                                    </button>
                                  )}
                                </div>

                                <div className="flex flex-col sm:flex-row gap-2 mt-1">
                                  <select
                                    value={selectedSessionLogForAudit?.id || ''}
                                    onChange={(e) => {
                                      const matchedLog = logs.find(l => l.id === e.target.value);
                                      if (matchedLog) {
                                        setSelectedSessionLogForAudit(matchedLog);
                                        const cleanedOrig = cleanParagraphs(matchedLog.originalCopyText || '');
                                        const cleanedCorr = cleanParagraphs(matchedLog.aiCorrectedText || matchedLog.originalCopyText || '');
                                        setOriginalCopy(cleanedOrig);
                                        setOriginalCopyHtml(generateParagraphHtml(cleanedOrig));
                                        setCurrentDraft(cleanedCorr);
                                        setCurrentDraftHtml(generateParagraphHtml(cleanedCorr));
                                        setHumanFinalizedCopy(cleanParagraphs(matchedLog.currentDraftText || matchedLog.originalCopyText || ''));
                                      } else {
                                        setSelectedSessionLogForAudit(null);
                                      }
                                    }}
                                    className={`flex-grow px-3 py-2 rounded-lg text-xs font-semibold border focus:outline-none transition-all ${
                                      theme === 'dark'
                                        ? 'bg-[#121214] border-zinc-800 text-zinc-200 focus:border-blue-800'
                                        : 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:border-blue-300'
                                    }`}
                                  >
                                    <option value="">
                                      {filteredAuditLogs.length === 0 
                                        ? '-- No matching logs found --' 
                                        : `-- Choose a shared log to audit (${filteredAuditLogs.length} matching) --`
                                      }
                                    </option>
                                    {filteredAuditLogs.map((log) => (
                                      <option key={log.id} value={log.id}>
                                        {log.logName || `Draft Review - ${log.timestamp}`} (Words: {log.wordCount})
                                      </option>
                                    ))}
                                  </select>
                                  {selectedSessionLogForAudit && (
                                    <button
                                      onClick={() => {
                                        setSelectedSessionLogForAudit(null);
                                        setHumanFinalizedCopy('');
                                      }}
                                      className={`px-3 py-2 rounded-lg text-xs font-bold uppercase transition-all border cursor-pointer shrink-0 ${
                                        theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400' : 'border-zinc-200 hover:bg-zinc-50 text-zinc-650'
                                      }`}
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                            
                            {selectedSessionLogForAudit && (
                              <div className={`mt-2 p-3.5 rounded-lg text-xs space-y-2.5 border leading-relaxed ${
                                theme === 'dark' ? 'bg-[#0f0f12] border-zinc-850' : 'bg-zinc-50/50 border-zinc-200'
                              }`}>
                                <div className="flex justify-between text-[9px] font-mono uppercase text-zinc-500 border-b pb-1.5 dark:border-zinc-800/40">
                                  <span>Selected Auditing Log: <strong className="text-blue-500">{selectedSessionLogForAudit.logName || 'Unnamed'}</strong></span>
                                  <span>Time: {selectedSessionLogForAudit.timestamp}</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                                  <div className="space-y-1">
                                    <span className="font-bold text-zinc-400 uppercase text-[9px] block">1. Original Story Text:</span>
                                    <div className="line-clamp-3 italic text-zinc-500 leading-snug">"{selectedSessionLogForAudit.originalCopyText}"</div>
                                  </div>
                                  <div className="space-y-1">
                                    <span className="font-bold text-blue-500 uppercase text-[9px] block">2. Standard AI Suggestion:</span>
                                    <div className="line-clamp-3 italic text-zinc-500 leading-snug">"{selectedSessionLogForAudit.aiCorrectedText || '(Baseline)'}"</div>
                                  </div>
                                  <div className="space-y-1">
                                    <span className="font-bold text-emerald-500 uppercase text-[9px] block">3. Final Human Sub-Edit:</span>
                                    <div className="line-clamp-3 font-semibold text-zinc-300 dark:text-zinc-600 leading-snug">"{selectedSessionLogForAudit.currentDraftText || '(Same as original)'}"</div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* 2. Comparing Target / Writing Canvas Form */}
                          <div className="flex flex-col gap-2.5">
                            <span className="text-[10px] uppercase font-bold text-zinc-400 font-mono flex items-center justify-between">
                              <span>Human Finalized Masterpiece & Sub-edited Copy (Target to Audit)</span>
                              {selectedSessionLogForAudit && (
                                <span className="text-[9px] px-2 py-0.5 bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold uppercase rounded-full">
                                  Populated Automatically from Session
                                </span>
                              )}
                            </span>
                            <textarea
                              value={humanFinalizedCopy}
                              onChange={(e) => { setHumanFinalizedCopy(e.target.value); }}
                              placeholder="Paste your copy here to compare with the AI..."
                              className={`w-full p-6 min-h-[250px] rounded-xl font-serif text-[16px] leading-relaxed focus:outline-none focus:ring-1 border resize-y ${
                                theme === 'dark'
                                  ? 'bg-[#121214] border-zinc-800 text-zinc-250 focus:ring-blue-800/40 focus:border-blue-800/40'
                                  : 'bg-white border-zinc-200 text-zinc-900 focus:ring-blue-105/30 focus:border-blue-105/30'
                              }`}
                            />
                          </div>

                          {/* Trigger Analysis Button */}
                          <div className="flex justify-end pt-2">
                            <button
                              onClick={handleRunCrossCheck}
                              disabled={crossCheckLoading || !humanFinalizedCopy.trim()}
                              className={`w-full md:w-auto px-6 py-3 rounded-lg border text-xs font-black uppercase tracking-[0.15em] cursor-pointer flex items-center justify-center gap-2 transition-all shadow-sm ${
                                theme === 'dark'
                                  ? 'border-blue-800 bg-gradient-to-r from-blue-700 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-500 disabled:bg-zinc-900'
                                  : 'border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-850 disabled:bg-zinc-100'
                              } ${
                                crossCheckLoading || !humanFinalizedCopy.trim()
                                  ? 'opacity-40 cursor-not-allowed text-zinc-500'
                                  : 'active:translate-y-0.5 hover:shadow-md'
                              }`}
                            >
                              {crossCheckLoading ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                                  Computing Gap Insights...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                                  Log Final Subbed Version
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Error Banner */}
                      {crossCheckError && (
                        <div className={`p-5 rounded-md border flex items-start gap-3 shadow-inner ${
                          theme === 'dark' ? 'bg-red-950/20 border-red-900/40 text-red-200' : 'bg-red-50 border-red-200 text-red-950'
                        }`}>
                          <AlertCircle className="w-5 h-5 shrink-0 text-red-650 mt-0.5" />
                          <div className="space-y-1">
                            <span className="font-bold block uppercase tracking-wide text-xs">Cross Check Failed</span>
                            <p className="font-medium text-xs leading-relaxed">{crossCheckError}</p>
                          </div>
                        </div>
                      )}

                      {/* COMPLIANCE DISCREPANCY DATABASE LOGS */}
                      <div className={`mt-6 p-6 rounded-xl border flex flex-col gap-6 ${
                        theme === 'dark' ? 'bg-[#121214] border-zinc-800' : 'bg-white border-zinc-200 shadow-sm'
                      }`}>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4 border-zinc-200/40 dark:border-zinc-800/60">
                          <div className="flex items-center gap-2.5">
                            <Database className="w-5 h-5 text-blue-500 animate-pulse shrink-0" />
                            <div className="flex flex-col min-w-0">
                              <h3 className="text-sm font-bold uppercase tracking-wider font-sans m-0 text-zinc-800 dark:text-zinc-150">
                                Audit Discrepancy Database
                              </h3>
                              <p className="text-[9px] uppercase font-semibold text-zinc-500 tracking-wider truncate">
                                Persistent audit trail of human-corrected style deviations for AI fine-tuning
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={downloadDbLogsJson}
                              disabled={dbLogs.length === 0}
                              className={`px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider font-bold flex items-center gap-1.5 border transition-all ${
                                dbLogs.length === 0
                                  ? 'opacity-40 cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800'
                                  : theme === 'dark'
                                    ? 'bg-blue-950/20 border-blue-900/60 text-blue-400 hover:bg-blue-900 hover:text-white cursor-pointer'
                                    : 'bg-blue-50 border-blue-100 text-blue-750 hover:bg-blue-600 hover:text-white cursor-pointer'
                              }`}
                              title={dbLogs.length === 0 ? "No corpus logs to download yet" : "Export database feedback as JSON standard corpus for fine-tuning"}
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download Corpus ({dbLogs.length})
                            </button>
                            
                            {dbLogs.length > 0 && (
                              <button
                                onClick={handleClearDbLogs}
                                className={`px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
                                  isConfirmingClearDb
                                    ? 'bg-red-600 border-red-650 text-white animate-pulse'
                                    : theme === 'dark'
                                      ? 'bg-red-950/10 border-red-900/30 text-red-450 hover:bg-red-800 hover:text-white'
                                      : 'bg-red-50 border-red-100 text-red-650 hover:bg-red-600 hover:text-white'
                                }`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {isConfirmingClearDb ? "Confirm Delete?" : "Clear Logs"}
                              </button>
                            )}
                          </div>
                        </div>

                        {dbLogsLoading ? (
                          <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-500 text-xs font-mono uppercase">
                            <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                            Syncing database records...
                          </div>
                        ) : dbLogs.length === 0 ? (
                          <div className="py-8 text-center text-zinc-500 text-xs font-mono uppercase border border-dashed border-zinc-200/50 dark:border-zinc-850 rounded-lg">
                            No logs recorded in the database yet. Run a discrepancy analysis to start logging style gaps.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-4">
                            {/* Summary Metrics */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
                              <div className={`p-4 rounded-lg border ${
                                theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-800' : 'bg-zinc-50/50 border-zinc-200'
                              }`}>
                                <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Total Logs</span>
                                <span className="text-xl font-black text-zinc-850 dark:text-zinc-200">{dbLogs.length}</span>
                              </div>
                              <div className={`p-4 rounded-lg border ${
                                theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-800' : 'bg-zinc-50/50 border-zinc-200'
                              }`}>
                                <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Avg Accuracy Score</span>
                                <span className="text-xl font-black text-blue-600 dark:text-blue-450">
                                  {Math.round(dbLogs.reduce((acc, log) => acc + (log.accuracyScore || 0), 0) / dbLogs.length)}%
                                </span>
                              </div>
                              <div className={`p-4 rounded-lg border ${
                                theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-800' : 'bg-zinc-50/50 border-zinc-200'
                              }`}>
                                <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Resolved Style Gaps</span>
                                <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                                  {dbLogs.reduce((acc, log) => acc + (log.missedInfractions?.length || 0), 0)}
                                </span>
                              </div>
                              <div className={`p-4 rounded-lg border ${
                                theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-800' : 'bg-zinc-50/50 border-zinc-200'
                              }`}>
                                <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Alignments Met</span>
                                <span className="text-xl font-black text-amber-600 dark:text-amber-400">
                                  {dbLogs.reduce((acc, log) => acc + (log.correctAdherences?.length || 0), 0)}
                                </span>
                              </div>
                            </div>

                            {/* Logs List */}
                            <div className="flex flex-col gap-3 max-h-[450px] overflow-y-auto pr-1">
                              {dbLogs.map((log) => {
                                const isExpanded = expandedDbLogId === log.id;
                                let dateStr = log.timestamp;
                                let timeStr = '';
                                const d = new Date(log.timestamp);
                                if (!isNaN(d.getTime())) {
                                  dateStr = d.toLocaleDateString('en-AU');
                                  timeStr = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
                                }
                                
                                let evaluatedStr = '';
                                if (log.lastEvaluatedAt) {
                                  const eD = new Date(log.lastEvaluatedAt);
                                  if (!isNaN(eD.getTime())) {
                                    evaluatedStr = ` • Evaluated: ${eD.toLocaleDateString('en-AU')} @ ${eD.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
                                  }
                                }
                                
                                // Color code scores
                                const scoreColor = 'text-blue-500 border-blue-500/20 bg-blue-500/10';

                                return (
                                  <div 
                                    key={log.id}
                                    className={`rounded-lg border transition-all ${
                                      theme === 'dark'
                                        ? 'border-zinc-800/80 bg-[#17171a]/50 hover:bg-[#17171a]'
                                        : 'border-zinc-200 bg-zinc-50/20 hover:bg-zinc-50'
                                    }`}
                                  >
                                    {/* Entry Header */}
                                    <div 
                                      onClick={() => setExpandedDbLogId(isExpanded ? null : log.id)}
                                      className="p-4 flex items-center justify-between gap-4 cursor-pointer select-none"
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <span className={`text-xs font-mono font-black border px-2 py-0.5 rounded shrink-0 ${scoreColor}`}>
                                          {log.accuracyScore}%
                                        </span>
                                        <div className="flex flex-col min-w-0">
                                          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">
                                            {log.alignmentGap ? log.alignmentGap : 'No prominent copy editorial gaps found.'}
                                          </span>
                                          <span className="text-[9px] font-mono text-zinc-500 uppercase mt-0.5">
                                            {dateStr} @ {timeStr} • {log.missedInfractions?.length || 0} gaps logged • {log.correctAdherences?.length || 0} correct{evaluatedStr}
                                          </span>
                                        </div>
                                      </div>
                                      
                                      <div className="flex items-center gap-2 shrink-0">
                                        <button
                                          onClick={(e) => handleReEvaluateLog(log.id, e)}
                                          disabled={reEvaluatingLogId !== null}
                                          className={`p-1.5 transition-colors rounded cursor-pointer ${
                                            reEvaluatingLogId === log.id
                                              ? 'text-emerald-500 bg-emerald-500/10'
                                              : 'text-zinc-500 hover:text-emerald-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                          }`}
                                          title="Retroactively Re-evaluate Alignment & calculate correct alignments"
                                        >
                                          <RefreshCw className={`w-3.5 h-3.5 ${reEvaluatingLogId === log.id ? 'animate-spin text-emerald-500' : ''}`} />
                                        </button>

                                        <button 
                                          onClick={(e) => handleDeleteDbLog(log.id, e)}
                                          className={`p-1.5 transition-colors rounded cursor-pointer ${
                                            deletingDbLogId === log.id 
                                              ? 'text-white bg-red-650 font-bold px-2 py-0.5 text-[9px] rounded animate-pulse' 
                                              : 'text-zinc-500 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                          }`}
                                          title={deletingDbLogId === log.id ? "Click again to confirm delete" : "Delete entry"}
                                        >
                                          {deletingDbLogId === log.id ? (
                                            "DELETE?"
                                          ) : (
                                            <Trash2 className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                        <span className="text-zinc-400">
                                          {isExpanded ? (
                                            <ChevronRight className="w-4 h-4 rotate-270 transform transition-transform" />
                                          ) : (
                                            <ChevronRight className="w-4 h-4 rotate-90 transform transition-transform" />
                                          )}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Expanded Body */}
                                    {isExpanded && (
                                      <div className="p-4 pt-0 border-t border-zinc-200/20 dark:border-zinc-800/60 flex flex-col gap-4 animate-fadeIn">
                                        {/* Texts Preview */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-xs leading-relaxed font-serif">
                                          <div className={`p-3 rounded border flex flex-col gap-1 ${
                                            theme === 'dark' ? 'bg-[#0f0f12] border-zinc-800' : 'bg-white border-zinc-200'
                                          }`}>
                                            <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase">Original draft snippet:</span>
                                            <p className="text-zinc-450 dark:text-zinc-400 italic line-clamp-3">"{log.originalCopy}"</p>
                                          </div>
                                          <div className={`p-3 rounded border flex flex-col gap-1 ${
                                            theme === 'dark' ? 'bg-[#0f0f12] border-zinc-800' : 'bg-white border-zinc-200'
                                          }`}>
                                            <span className="text-[9px] font-mono font-bold text-blue-500 uppercase">Human masterpiece snippet:</span>
                                            <p className="text-zinc-800 dark:text-zinc-200 font-bold line-clamp-3">"{log.humanFinalized}"</p>
                                          </div>
                                        </div>

                                        {/* Actionable summary */}
                                        {log.fineTuningActionable && (
                                          <div className="text-xs">
                                            <span className="text-[9px] uppercase font-bold text-zinc-500 font-mono">Fine-Tuning Recommendation:</span>
                                            <p className="text-zinc-700 dark:text-zinc-300 italic font-serif mt-1">{log.fineTuningActionable}</p>
                                          </div>
                                        )}

                                        {/* Missed Infractions List */}
                                        {log.missedInfractions && log.missedInfractions.length > 0 && (
                                          <div className="flex flex-col gap-2.5">
                                            <span className="text-[9px] font-mono uppercase font-semibold text-zinc-500">Logged Infraction Details ({log.missedInfractions.length})</span>
                                            <div className="flex flex-col gap-2">
                                              {log.missedInfractions.map((inf: any, infIdx: number) => (
                                                <div 
                                                  key={infIdx}
                                                  className={`p-3 rounded border text-xs flex flex-col gap-2 ${
                                                    theme === 'dark' ? 'bg-[#18181c]/40 border-zinc-800/60' : 'bg-zinc-150/10 border-zinc-200/50'
                                                  }`}
                                                >
                                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <span className="text-[9px] font-mono font-bold uppercase py-0.5 px-1.5 bg-blue-500/10 text-blue-550 dark:text-blue-400 rounded border border-blue-500/20">
                                                      {inf.rule}
                                                    </span>
                                                    <span className="text-[9px] font-mono text-zinc-500 uppercase">
                                                      Register: {inf.targetGuide || 'editorial'}
                                                    </span>
                                                  </div>
                                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[9px] mt-1 text-zinc-500">
                                                    <div>AI missed: <span className="text-red-500 line-through">"{inf.original}"</span></div>
                                                    <div>Human: <span className="text-emerald-600 dark:text-emerald-400 font-bold">"{inf.human}"</span></div>
                                                    <div>AI got: <span className="text-zinc-450 font-bold">"{inf.ai || '(No correction)'}"</span></div>
                                                  </div>
                                                  <div className="text-xs italic text-zinc-650 dark:text-zinc-400 mt-1 font-serif">
                                                    {inf.explanation}
                                                  </div>
                                                  <div className="space-y-0.5 mt-1 border-t pt-1.5 border-zinc-200/50 dark:border-zinc-800/65">
                                                    <span className="text-[8px] tracking-wide uppercase text-blue-500 block">Fine-Tuning Register Patch:</span>
                                                    <code className="text-[10px] font-mono block bg-[#0c0c0e] text-zinc-300 dark:text-zinc-200 p-2 rounded font-medium select-all border border-zinc-800/35">
                                                      {inf.fineTuningPatch}
                                                    </code>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Correct Adherences List */}
                                        {log.correctAdherences && log.correctAdherences.length > 0 && (
                                          <div className="flex flex-col gap-2.5 mt-2 pt-2 border-t border-zinc-200/40 dark:border-zinc-800/60">
                                            <span className="text-[9px] font-mono uppercase font-semibold text-emerald-500">Correct Alignments ({log.correctAdherences.length})</span>
                                            <div className="flex flex-col gap-2">
                                              {log.correctAdherences.map((adh: any, adhIdx: number) => (
                                                <div 
                                                  key={adhIdx}
                                                  className={`p-3 rounded border text-xs flex flex-col gap-2 ${
                                                    theme === 'dark' ? 'bg-[#18181c]/40 border-zinc-800/60' : 'bg-emerald-50/10 border-emerald-250/30'
                                                  }`}
                                                >
                                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <span className="text-[9px] font-mono font-bold uppercase py-0.5 px-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded border border-emerald-500/20">
                                                      {adh.rule}
                                                    </span>
                                                  </div>
                                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[9px] mt-1 text-zinc-500">
                                                    <div>Original copy: <span className="text-zinc-450">"{adh.original}"</span></div>
                                                    <div>Aligned styling: <span className="text-emerald-600 dark:text-emerald-400 font-bold">"{adh.corrected}"</span></div>
                                                  </div>
                                                  <div className="text-xs italic text-zinc-650 dark:text-zinc-400 mt-1 font-serif">
                                                    {adh.explanation}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : editMode ? (
                    /* Manual Edit Mode: Live Rich Text Editor */
                    <div className={`w-full max-w-2xl h-full flex flex-col p-8 pt-10 shadow-sm relative min-h-[400px] border rounded ${
                      theme === 'dark' ? 'bg-[#18181b] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200/80 text-zinc-900'
                    }`}>
                      <div className={`absolute top-3 left-4 text-[10px] font-mono uppercase font-semibold ${
                        theme === 'dark' ? 'text-blue-400' : 'text-[#0055FF]'
                      }`}>
                        Manual Draft Editor
                      </div>
                      <div
                        ref={editorRef}
                        contentEditable
                        onInput={handleEditorChange}
                        onPaste={handleManualEditorPaste}
                        className="editorial-canvas w-full h-full flex-grow bg-transparent border-none focus:outline-none font-serif text-[18px] leading-relaxed overflow-y-auto outline-none select-text"
                        spellCheck={false}
                      />
                      <div className="absolute bottom-4 right-6 text-[10px] font-mono text-gray-400">
                        Editing Active — highlights will reflect automatically on toggle
                      </div>
                    </div>
                  ) : (
                    /* Highlight review mode: Document rendering stage */
                    <article className={`${currentTheme.paper} transition-all rounded`}>
                      
                      <div className="absolute top-4 left-6 flex items-center gap-2">
                        <span className={`text-[9px] font-mono font-black uppercase tracking-widest ${
                          theme === 'dark' ? 'text-blue-400' : 'text-brand-blue'
                        }`}>
                          Editorial Draft
                        </span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      </div>

                      <div 
                        className={`editorial-canvas font-serif text-[18px] leading-relaxed space-y-6 mt-8 cursor-text outline-none select-text ${
                          theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'
                        }`}
                        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                        onClick={handleWorkspaceClick}
                      />


                    </article>
                  )}
                  
                  {/* Bottom Back / Re-analyse button actions */}
                  <div className="max-w-2xl w-full mt-8 flex justify-between shrink-0 mb-16 px-1">
                    <button
                      onClick={() => { setIssues([]); setOriginalCopy(''); setCopy(''); setCustomLogName(''); }}
                      className={`px-4 py-2 rounded-lg text-xs font-mono uppercase font-bold flex items-center gap-2 cursor-pointer transition-all border shadow-sm ${
                        theme === 'dark' 
                          ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500 hover:text-white hover:border-blue-400' 
                          : 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700 hover:text-white hover:border-blue-700'
                      }`}
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Start New Draft
                    </button>
                    
                    <button
                      disabled={loading}
                      onClick={() => { 
                        setCopy(currentDraft); 
                        handleReview(currentDraft); 
                      }}
                      className={`text-xs font-mono uppercase font-bold flex items-center gap-1 transition-opacity ${
                        loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:underline'
                      } ${
                        theme === 'dark' ? 'text-blue-400' : 'text-brand-blue'
                      }`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                      {loading ? 'Analysing draft...' : 'Re-analyse active draft'}
                    </button>
                  </div>

                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Editorial Page Footer */}
      <footer className={currentTheme.footer}>
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
            theme === 'dark'
              ? 'bg-amber-950/40 border-amber-800/60 text-amber-400'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            <Lock className="w-3 h-3 text-amber-500" />
            Internal Use Only
          </span>
          <span className={`text-[11px] hidden sm:inline font-medium ${
            theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'
          }`}>
            Broadsheet Editorial Style Checker • Proprietary &amp; Confidential
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-mono uppercase tracking-widest ${
            theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'
          }`}>
            Broadsheet Media © {new Date().getFullYear()}
          </span>
        </div>
      </footer>

      {/* Macquarie Dictionary Upload Modal */}
      {showMacquarieManager && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`w-full max-w-2xl rounded-xl flex flex-col overflow-hidden shadow-2xl border ${
              theme === 'dark' ? 'bg-[#0f0f13] border-zinc-800' : 'bg-white border-zinc-200'
            }`}
          >
            <div className={`p-4 border-b flex items-center justify-between ${
              theme === 'dark' ? 'bg-[#141418] border-zinc-800' : 'bg-zinc-50 border-zinc-200'
            }`}>
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-bold font-sans tracking-tight">Macquarie Dictionary Management</h2>
              </div>
              <button
                onClick={() => setShowMacquarieManager(false)}
                className={`p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors`}
              >
                <X className="w-5 h-5 opacity-60" />
              </button>
            </div>
            
            <div className="p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              {/* Drag and Drop and Text Input Area */}
              <div className="flex flex-col gap-3">
                <div
                  onDragEnter={handleMacquarieDrag}
                  onDragOver={handleMacquarieDrag}
                  onDragLeave={handleMacquarieDrag}
                  onDrop={handleMacquarieDrop}
                  onClick={() => document.getElementById('macquarie-file-select')?.click()}
                  className={`border-2 border-dashed rounded-lg p-5 text-center transition-all relative cursor-pointer ${
                    dragActive
                      ? theme === 'dark' ? 'border-blue-500 bg-blue-950/20' : 'border-[#0055FF] bg-blue-50/50'
                      : theme === 'dark' ? 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/5' : 'border-zinc-250 hover:border-zinc-350 bg-zinc-50/20'
                  }`}
                >
                  <input
                    type="file"
                    id="macquarie-file-select"
                    accept=".json,application/json"
                    onChange={handleMacquarieFileSelect}
                    className="hidden"
                  />
                  <p className="text-xs uppercase font-bold tracking-widest text-[#0055FF] dark:text-blue-400">
                    Drag & drop Macquarie Dictionary `.json` here
                  </p>
                  <p className="text-[9px] text-zinc-400 font-mono mt-0.5 uppercase">
                    or click to choose file / paste JSON below
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase font-bold text-gray-400 font-mono">
                    Paste Dictionary RAW JSON Code
                  </span>
                  <textarea
                    value={macquarieInput}
                    onChange={(e) => {
                      setMacquarieInput(e.target.value);
                      setMacquarieError('');
                      macquarieFileContentRef.current = null;
                    }}
                    placeholder={`Optionally, paste raw JSON dictionary. Format can be a key-value object:\n{ "yoghurt": "preferred spelling...", "bickie": "preferred over bikkie" }\nOr an array of objects:\n[ { "word": "yoghurt", "definition": "..." } ]`}
                    className={`w-full h-32 p-3 font-mono text-xs rounded-lg border focus:ring-2 focus:ring-[#0055FF]/20 focus:border-[#0055FF] outline-none transition-all resize-y ${
                      theme === 'dark'
                        ? 'bg-[#18181C] border-[#1f1f23] text-zinc-300 placeholder-zinc-700'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-800 placeholder-zinc-400'
                    }`}
                  />
                </div>
              </div>

              {/* Error display */}
              {macquarieError && (
                <div className="p-3 text-[10px] bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 leading-normal font-mono uppercase">
                  <strong>Import Failure:</strong> {macquarieError}
                </div>
              )}
            </div>

            <div className={`p-4 border-t flex items-center justify-between ${
              theme === 'dark' ? 'bg-[#141418] border-zinc-800' : 'bg-zinc-50 border-zinc-200'
            }`}>
              {macquarieStatus?.imported ? (
                <button
                  onClick={() => {
                    if (confirmClearMacquarie) {
                      handleClearMacquarie();
                      setConfirmClearMacquarie(false);
                    } else {
                      setConfirmClearMacquarie(true);
                    }
                  }}
                  className={`text-[9px] font-mono font-bold uppercase tracking-wider px-3 py-2 border rounded cursor-pointer transition-colors shrink-0 ${
                    confirmClearMacquarie 
                      ? 'bg-red-600 border-red-600 text-white animate-pulse'
                      : 'border-red-500/20 text-red-500 hover:bg-red-500/10'
                  }`}
                >
                  {confirmClearMacquarie ? "Confirm Delete?" : "Delete Custom Dictionary"}
                </button>
              ) : (
                <div />
              )}

              <button
                onClick={() => handleImportMacquarie()}
                disabled={isUploadingMacquarie || !macquarieInput.trim() && !macquarieFileContentRef.current}
                className={`px-5 py-2 border rounded-lg text-xs font-bold uppercase cursor-pointer flex items-center gap-1.5 transition-all ${
                  theme === 'dark'
                    ? 'border-blue-800 bg-blue-600 text-white hover:bg-blue-500'
                    : 'border-zinc-950 bg-[#0055FF] text-white hover:bg-blue-650'
                } ${isUploadingMacquarie || (!macquarieInput.trim() && !macquarieFileContentRef.current) ? 'opacity-40 cursor-not-allowed text-zinc-400' : 'active:translate-y-0.5 shadow-sm'}`}
              >
                {isUploadingMacquarie ? 'Importing JSON...' : 'Import & Save Dictionary'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Refinement & Testing Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`w-full max-w-4xl h-[85vh] rounded-xl flex flex-col overflow-hidden shadow-2xl border ${
              theme === 'dark' ? 'bg-[#121214] border-zinc-805 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            {/* Modal Header */}
            <div className={`p-6 border-b flex justify-between items-center shrink-0 ${
              theme === 'dark' ? 'border-zinc-850 bg-zinc-900/60' : 'border-zinc-100 bg-zinc-50'
            }`}>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider font-sans m-0 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#0055FF]" /> style guide refinement report
                </h3>
                <p className={`text-xs mt-1 uppercase tracking-wider font-mono ${
                  theme === 'dark' ? 'text-zinc-500' : 'text-zinc-600'
                }`}>
                  Track and report accepted modifications and ignored recommendations to refine style guide rules.
                </p>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                className={`p-1.5 rounded-full border transition-all hover:bg-zinc-100/10 cursor-pointer ${
                  theme === 'dark' ? 'border-zinc-800 text-zinc-400 hover:text-zinc-100' : 'border-zinc-200 text-zinc-500 hover:text-zinc-900'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content container */}
            <div className="flex-grow flex flex-col overflow-hidden p-6 gap-4">
              
              {/* Stats overview banner */}
              <div className={`grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-lg border text-center font-mono uppercase tracking-wider text-xs shrink-0 ${
                theme === 'dark' ? 'bg-[#18181F] border-zinc-805 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-650'
              }`}>
                <div>
                  <span className="text-[9px] text-zinc-400 block mb-0.5">Identified</span>
                  <span className={`text-base font-bold ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'}`}>{issues.length}</span>
                </div>
                <div>
                  <span className="text-[9px] text-emerald-500 block mb-0.5">Accepted</span>
                  <span className="text-base font-bold text-emerald-600">{issues.filter(i => i.status === 'accepted').length}</span>
                </div>
                <div>
                  <span className="text-[9px] text-zinc-500 block mb-0.5">Ignored</span>
                  <span className="text-base font-bold text-zinc-500">{issues.filter(i => i.status === 'rejected').length}</span>
                </div>
                <div>
                  <span className="text-[9px] text-amber-500 block mb-0.5">Pending</span>
                  <span className="text-base font-bold text-amber-500">{issues.filter(i => i.status === 'pending').length}</span>
                </div>
              </div>

              {/* Internal navigation tabs */}
              <div className="flex border-b border-zinc-250/20 gap-2 shrink-0">
                {(['all', 'accepted', 'ignored'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveReportTab(tab)}
                    className={`pb-2 px-3 text-xs uppercase tracking-wider font-bold transition-all relative cursor-pointer select-none ${
                      activeReportTab === tab
                        ? theme === 'dark' ? 'text-blue-400' : 'text-[#0055FF]'
                        : 'text-zinc-400 hover:text-zinc-650'
                    }`}
                  >
                    {tab === 'all' ? 'RAW Markdown Report' : tab === 'accepted' ? 'Accepted Corrections' : 'Ignored Recommendations'}
                    {activeReportTab === tab && (
                      <motion.div
                        layoutId="activeTabUnderline"
                        className={`absolute bottom-0 left-0 right-0 h-0.5 ${
                          theme === 'dark' ? 'bg-blue-500' : 'bg-[#0055FF]'
                        }`}
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Dynamic scroll content area */}
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                {activeReportTab === 'all' ? (
                  <div className="space-y-3 h-full flex flex-col">
                    <div className="flex items-center justify-between shrink-0">
                      <span className="text-[10px] uppercase font-bold text-gray-400">Copyable Markdown Output</span>
                      <button
                        onClick={copyReportToClipboard}
                        className={`text-[10px] font-bold uppercase transition-all px-3 py-1.5 flex items-center gap-1 cursor-pointer rounded ${
                          reportCopied
                            ? 'bg-emerald-600 text-white'
                            : theme === 'dark'
                              ? 'bg-zinc-850 text-zinc-200 hover:bg-zinc-800'
                              : 'bg-zinc-950 text-white hover:bg-zinc-850'
                        }`}
                      >
                        {reportCopied ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {reportCopied ? 'Copied to Clipboard!' : 'Copy Full Report'}
                      </button>
                    </div>
                    
                    <textarea
                      value={customReportText !== null ? customReportText : generateReportText()}
                      onChange={(e) => setCustomReportText(e.target.value)}
                      placeholder="Generating report..."
                      className={`w-full flex-grow p-4 min-h-[350px] font-mono text-xs leading-relaxed border rounded-lg resize-y ${
                        theme === 'dark' 
                          ? 'bg-[#0E0E10] border-zinc-805 text-zinc-300 focus:border-zinc-650 focus:outline-none' 
                          : 'bg-zinc-50 border-zinc-200 text-zinc-800 focus:border-zinc-400 focus:outline-none'
                      }`}
                    />
                  </div>
                ) : activeReportTab === 'accepted' ? (
                  <div className="space-y-4">
                    {issues.filter(i => i.status === 'accepted').length === 0 ? (
                      <div className={`text-center py-12 text-zinc-400 text-xs uppercase tracking-wider border border-dashed rounded ${
                        theme === 'dark' ? 'bg-[#18181F]/30 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                      }`}>
                        No accepted corrections yet in this session.
                      </div>
                    ) : (
                      issues.filter(i => i.status === 'accepted').map((item, idx) => (
                        <div key={idx} className={`p-4 border rounded-lg space-y-3 text-xs ${
                          theme === 'dark' ? 'bg-zinc-900/45 border-zinc-800/80 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-800 shadow-sm'
                        }`}>
                          <div className="flex justify-between items-center pb-2 border-b border-zinc-250/10">
                            <span className="px-2 py-0.5 bg-emerald-600 text-white rounded text-[9px] font-mono font-bold uppercase">Accepted #{idx + 1}</span>
                            <span className="text-[10px] font-mono font-semibold text-zinc-400">Rule Group: {item.rule}</span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                            <div className="p-2.5 bg-zinc-900/20 border border-zinc-500/10 rounded">
                              <span className="text-[9px] block text-zinc-400 font-bold uppercase mb-1">Found Content:</span>
                              <span className="font-serif italic text-sm">"{item.original}"</span>
                            </div>
                            <div className="p-2.5 bg-emerald-950/20 border border-emerald-500/10 rounded">
                              <span className="text-[9px] block text-emerald-400 font-bold uppercase mb-1">Corrected To:</span>
                              <span className="font-serif font-bold text-sm text-emerald-500">"{item.fix || '(Omitted)'}"</span>
                            </div>
                          </div>
                          <p className={`text-[11px] leading-relaxed italic ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-650'}`}>
                            <strong>Editorial Feedback:</strong> {item.issue}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {issues.filter(i => i.status === 'rejected').length === 0 ? (
                      <div className={`text-center py-12 text-zinc-400 text-xs uppercase tracking-wider border border-dashed rounded ${
                        theme === 'dark' ? 'bg-[#18181F]/30 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                      }`}>
                        No ignored suggestions yet.
                      </div>
                    ) : (
                      issues.filter(i => i.status === 'rejected').map((item, idx) => (
                        <div key={idx} className={`p-4 border rounded-lg space-y-3 text-xs ${
                          theme === 'dark' ? 'bg-zinc-900/45 border-zinc-800/80 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-800 shadow-sm'
                        }`}>
                          <div className="flex justify-between items-center pb-2 border-b border-zinc-250/10">
                            <span className="px-2 py-0.5 bg-zinc-650 text-white rounded text-[9px] font-mono font-bold uppercase">Ignored #{idx + 1}</span>
                            <span className="text-[10px] font-mono font-semibold text-zinc-400">Rule Group: {item.rule}</span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                            <div className="p-2.5 bg-zinc-900/20 border border-zinc-500/10 rounded">
                              <span className="text-[9px] block text-zinc-400 font-bold uppercase mb-1">Retained Original Content:</span>
                              <span className="font-serif italic text-sm">"{item.original}"</span>
                            </div>
                            <div className="p-2.5 bg-zinc-900/10 border border-zinc-500/10 rounded opacity-60">
                              <span className="text-[9px] block text-zinc-400 font-bold uppercase mb-1">Suggested Fix (Bypassed):</span>
                              <span className="font-serif text-sm text-zinc-500">"{item.fix || '(Omitted)'}"</span>
                            </div>
                          </div>
                          <p className={`text-[11px] leading-relaxed italic ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-650'}`}>
                            <strong>Style Complaint:</strong> {item.issue}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className={`p-4 border-t flex justify-end shrink-0 gap-2 ${
              theme === 'dark' ? 'border-zinc-850 bg-zinc-900/40' : 'border-zinc-100 bg-zinc-50'
            }`}>
              <button
                onClick={() => setShowReportModal(false)}
                className={`px-5 py-2 border rounded-lg text-xs font-bold uppercase cursor-pointer transition-all ${
                  theme === 'dark'
                    ? 'border-zinc-800 text-zinc-250 bg-zinc-900 hover:bg-zinc-800'
                    : 'border-zinc-200 text-zinc-700 bg-white hover:bg-zinc-100 shadow-sm'
                }`}
              >
                Close Report
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Review History Logs History (Firestore Synced) */}
      {showLogsModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`w-full max-w-5xl h-[85vh] rounded-xl flex flex-col overflow-hidden shadow-2xl border ${
              theme === 'dark' ? 'bg-[#121214] border-zinc-805 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
              {/* Modal Header */}
              <div className={`p-6 border-b flex justify-between items-center shrink-0 ${
                theme === 'dark' ? 'border-zinc-850 bg-zinc-900/60' : 'border-zinc-100 bg-zinc-50'
              }`}>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider font-sans m-0 flex items-center gap-2">
                    <History className="w-4 h-4 text-[#0055FF]" /> Style Check Log History
                    <span className="text-[10px] lowercase font-normal font-mono border border-zinc-500/20 px-2 py-0.5 rounded text-zinc-400 bg-zinc-500/5">
                      shared database
                    </span>
                  </h3>
                  <p className={`text-xs mt-1 uppercase tracking-wider font-mono ${
                    theme === 'dark' ? 'text-zinc-500' : 'text-zinc-650'
                  }`}>
                    Browse previously completed review sessions, audit review outputs, or reload drafts.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={downloadComplianceLogsJson}
                    disabled={logs.length === 0}
                    className={`px-2.5 py-1.5 border text-[10px] font-bold uppercase tracking-wider rounded select-none transition-all flex items-center gap-1.5 ${
                      logs.length === 0
                        ? 'opacity-40 cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800'
                        : theme === 'dark'
                          ? 'border-blue-500/30 text-blue-455 hover:bg-blue-600/15 cursor-pointer'
                          : 'border-blue-200 bg-blue-50/50 text-blue-750 hover:bg-blue-100 cursor-pointer'
                    }`}
                    title={logs.length === 0 ? "No history logs to download" : "Download review compliance history as JSON"}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Logs
                  </button>
                  {logs.length > 0 && (
                    <button
                      onClick={clearLogHistory}
                      className="px-2.5 py-1.5 border border-red-500/30 text-red-500 hover:bg-red-500/10 text-[10px] font-bold uppercase tracking-wider rounded select-none cursor-pointer transition-all"
                      title="Clear all session logs"
                    >
                      Clear History
                    </button>
                  )}
                  <button
                    onClick={() => setShowLogsModal(false)}
                    className={`p-1.5 rounded-full border transition-all hover:bg-zinc-100/10 cursor-pointer ${
                      theme === 'dark' ? 'border-zinc-800 text-zinc-400 hover:text-zinc-100' : 'border-zinc-200 text-zinc-500 hover:text-zinc-900'
                    }`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Shared Database Status & Analytics Header Panel */}
              {logs.length > 0 && (
                <div className={`px-6 py-4 border-b flex flex-col md:flex-row gap-5 items-center shrink-0 justify-between ${
                  theme === 'dark' ? 'bg-[#15151A] border-zinc-850' : 'bg-[#FAF9F6] border-zinc-200/80'
                }`}>
                  {/* Average Metric Cards */}
                  <div className="flex flex-col sm:flex-row gap-6 shrink-0 w-full md:w-auto">
                    {/* Card 1: Acceptance Rate */}
                    <div className="flex items-center gap-4 font-mono tracking-wider">
                      {/* Mini Progress Ring */}
                      <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
                        <svg className="w-12 h-12 transform -rotate-90">
                          <circle
                            cx="24"
                            cy="24"
                            r="20"
                            className={`${theme === 'dark' ? 'stroke-zinc-800' : 'stroke-zinc-200'}`}
                            strokeWidth="3.5"
                            fill="transparent"
                          />
                          <circle
                            cx="24"
                            cy="24"
                            r="20"
                            className="stroke-blue-500 transition-all duration-300"
                            strokeWidth="3.5"
                            fill="transparent"
                            strokeDasharray={2 * Math.PI * 20}
                            strokeDashoffset={2 * Math.PI * 20 * (1 - averageAcceptanceRate / 100)}
                          />
                        </svg>
                        <span className="absolute text-[10px] font-bold text-blue-500">{averageAcceptanceRate}%</span>
                      </div>
                      <div>
                        <h4 className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">Running Average</h4>
                        <p className={`text-xs font-black mt-1 m-0 flex items-center gap-1.5 ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-800'}`}>
                          {averageAcceptanceRate}% Acceptance
                          <span className="text-[10px] font-normal text-zinc-400 font-sans tracking-tight">({logs.length} runs)</span>
                        </p>
                      </div>
                    </div>

                    {/* Card 2: Accepted per 100 words */}
                    <div className="flex items-center gap-4 font-mono tracking-wider border-t sm:border-t-0 sm:border-l pt-4 sm:pt-0 sm:pl-6 border-zinc-200 dark:border-zinc-800">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center bg-blue-500/10 border border-blue-500/20 text-blue-500 shrink-0">
                        <PenTool className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">Changes / 100 Words</h4>
                        <p className={`text-xs font-black mt-1 m-0 flex items-center gap-1.5 ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-800'}`}>
                          {averageAcceptedChangesPer100Words.toFixed(1)} Accepted
                          <span className="text-[10px] font-normal text-zinc-400 font-sans tracking-tight">avg rate</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Sparkline Trend Graph */}
                  {logsChronological.length > 1 && (
                    <div className={`flex-grow max-w-xl h-11 flex items-center p-1 rounded border relative w-full ${
                      theme === 'dark' ? 'bg-[#0E0E10] border-zinc-805/80' : 'bg-white border-zinc-200/70 shadow-sm'
                    }`}>
                      <span className="absolute left-2.5 top-0.5 text-[8px] font-bold font-mono text-zinc-500 uppercase tracking-wider">
                        Compliance Acceptance Trend Over Time
                      </span>
                      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-full pt-3 pb-1 pr-2">
                        {/* Baseline labels */}
                        <line x1={paddingX} y1={svgHeight - paddingY} x2={svgWidth - paddingX} y2={svgHeight - paddingY} stroke="#888" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.3" />
                        <line x1={paddingX} y1={paddingY} x2={svgWidth - paddingX} y2={paddingY} stroke="#888" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.3" />
                        
                        <text x={paddingX - 8} y={paddingY + 3} textAnchor="end" className="text-[9px] fill-zinc-500 font-mono" opacity="0.6">100%</text>
                        <text x={paddingX - 8} y={svgHeight - paddingY + 3} textAnchor="end" className="text-[9px] fill-zinc-500 font-mono" opacity="0.6">0%</text>

                        {/* Area under curve */}
                        <polygon
                          points={`${paddingX},${svgHeight - paddingY} ${sparklineTrendPoints} ${svgWidth - paddingX},${svgHeight - paddingY}`}
                          fill="url(#trendGradientLogs)"
                          opacity="0.15"
                        />
                        <defs>
                          <linearGradient id="trendGradientLogs" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                          </linearGradient>
                        </defs>

                        {/* Connected Polyline */}
                        <polyline
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={sparklineTrendPoints}
                        />

                        {/* Data Points (Markers) */}
                        {logsChronological.map((log, idx) => {
                          const stepX = (svgWidth - paddingX * 2) / (logsChronological.length - 1);
                          const rate = log.totalSuggestions > 0 ? (log.acceptedCount / log.totalSuggestions) * 100 : 100;
                          const x = paddingX + idx * stepX;
                          const y = svgHeight - paddingY - (rate / 100) * (svgHeight - paddingY * 2);
                          return (
                            <g key={log.id} className="group/dot cursor-pointer">
                              <circle
                                cx={x}
                                cy={y}
                                r="2.5"
                                className="fill-blue-500 stroke-white dark:stroke-zinc-900 stroke-1.5 transition-all group-hover/dot:r-4"
                              />
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  )}
                </div>
              )}

              {/* Split content area */}
              <div className={`flex-grow flex overflow-hidden min-h-0 ${theme === 'dark' ? 'bg-[#0E0E10]/40' : 'bg-[#FAF9F6]/30'}`}>
              {/* Left sidebar - past logs list */}
              <div className={`w-full sm:w-[320px] md:w-[360px] flex flex-col border-r overflow-y-auto custom-scrollbar p-4 shrink-0 gap-3 ${
                theme === 'dark' ? 'border-zinc-850' : 'border-zinc-200 bg-zinc-50/50'
              }`}>
                {logs.length === 0 ? (
                  <div className="flex-grow flex flex-col items-center justify-center text-center p-6 gap-2 border border-dashed rounded-lg border-zinc-500/20">
                    <History className="w-8 h-8 text-zinc-400 opacity-70" />
                    <p className={`text-xs uppercase tracking-wider font-bold ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>No Logs Found</p>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 leading-normal max-w-[220px]">
                      Completed reviews are logged automatically. Paste editorial copy and launch style check to record logs.
                    </p>
                  </div>
                ) : (
                  logs.map((log) => {
                    const isSelected = selectedLogId === log.id;
                    const modeBg = 'bg-blue-600/10 text-blue-500 border border-blue-600/20';

                    return (
                      <div
                        key={log.id}
                        onClick={() => setSelectedLogId(log.id)}
                        className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all relative flex flex-col gap-2 group ${
                          isSelected
                            ? theme === 'dark'
                              ? 'bg-[#18181F] border-blue-600 shadow-md translate-x-1 ring-1 ring-blue-900/20'
                              : 'bg-white border-[#0055FF] shadow-sm translate-x-1 ring-1 ring-[#0055FF]/10'
                            : theme === 'dark'
                              ? 'bg-zinc-900/60 border-zinc-800/80 hover:border-zinc-700 hover:bg-[#15151A]'
                              : 'bg-white border-zinc-200 hover:border-zinc-350 shadow-sm'
                        }`}
                      >
                        {/* Upper line: badge and delete */}
                        <div className="flex justify-between items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider ${modeBg}`}>
                            editorial
                          </span>
                          
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-zinc-500">
                              {log.totalSuggestions} Fix{log.totalSuggestions !== 1 ? 'es' : ''}
                            </span>
                            <button
                              onClick={(e) => deleteLog(log.id, e)}
                              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-zinc-500 hover:text-red-500 transition-all cursor-pointer"
                              title="Delete log entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Summary preview */}
                        <p className={`text-[11px] line-clamp-2 leading-relaxed font-serif italic ${
                          theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600 font-medium'
                        }`}>
                          "{log.draftSummary}"
                        </p>

                        {/* Lower line: timestamp & statistics */}
                        <div className="flex justify-between items-center pt-2 border-t border-zinc-250/10 text-[9px] font-mono">
                          <span className="text-zinc-400">{log.timestamp}</span>
                          <div className="flex items-center gap-2">
                            <div className="flex gap-1.5 font-bold">
                              <span className="text-emerald-500" title="Accepted suggestions">{log.acceptedCount}A</span>
                              <span className="text-zinc-400" title="Ignored suggestions">{log.ignoredCount}I</span>
                              {log.pendingCount > 0 && <span className="text-amber-500" title="Left pending">{log.pendingCount}P</span>}
                            </div>
                            <span className="text-blue-500 font-bold border-l border-zinc-500/20 pl-2" title="Accepted changes per 100 words">
                              {((log.wordCount > 0 ? log.acceptedCount / log.wordCount : 0) * 100).toFixed(1)}/100w
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Right panel - detailed selected log report */}
              <div className="flex-1 flex flex-col overflow-hidden p-6 gap-4 min-w-0">
                {(() => {
                  const selectedLog = logs.find(l => l.id === selectedLogId);
                  if (!selectedLog) {
                    return (
                      <div className="flex-grow flex flex-col items-center justify-center text-center p-12 text-zinc-400 gap-2">
                        <FileText className="w-10 h-10 opacity-40 mb-2 text-[#0055FF]" />
                        <h4 className="text-xs uppercase tracking-wider font-bold">Select a Session Log</h4>
                        <p className="text-[11px] uppercase tracking-wider text-zinc-500 leading-normal max-w-sm">
                          Select any individual completed review report from the left sidebar to inspect editorial suggestions, audit applied revisions and recover original content states.
                        </p>
                      </div>
                    );
                  }

                  const handleCopyLogReport = () => {
                    navigator.clipboard.writeText(selectedLog.reportMarkdown).then(() => {
                      setLogReportCopied(true);
                      setTimeout(() => setLogReportCopied(false), 2000);
                    }).catch(() => {
                      // fallback
                      const textarea = document.createElement('textarea');
                      textarea.value = selectedLog.reportMarkdown;
                      document.body.appendChild(textarea);
                      textarea.select();
                      try {
                        document.execCommand('copy');
                        setLogReportCopied(true);
                        setTimeout(() => setLogReportCopied(false), 2000);
                      } catch (e) {
                        console.error('Manual copy failed', e);
                      }
                      document.body.removeChild(textarea);
                    });
                  };

                  return (
                    <div className="flex-grow flex flex-col overflow-y-auto gap-4 h-full pr-1">
                      {/* Detailed info bar */}
                      <div className="flex flex-col md:flex-row justify-between md:items-center gap-3 pb-3 border-b border-zinc-250/10 shrink-0">
                        <div>
                          <span className="px-2.5 py-0.5 rounded bg-blue-600/10 text-[#0055FF] border border-blue-600/20 text-[9px] font-mono font-bold uppercase tracking-wider">
                            Session ID: {selectedLog.id}
                          </span>
                          <h4 className="text-xs font-bold uppercase tracking-wide font-mono mt-1 pt-1.5 flex items-center gap-1.5">
                            Status Snapshot: {selectedLog.timestamp} - EDITORIAL Styling
                          </h4>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => loadOriginalCopyFromLog(selectedLog)}
                            className={`px-3 py-1.5 border rounded text-[10px] font-bold uppercase cursor-pointer select-none transition-all flex items-center gap-1.5 ${
                              theme === 'dark'
                                ? 'border-[#0055FF]/40 text-blue-400 bg-blue-950/10 hover:bg-blue-950/30'
                                : 'border-[#0055FF]/30 text-[#0055FF] bg-[#0055FF]/5 hover:bg-[#0055FF] hover:text-white'
                            }`}
                            title="Load the draft text of this logged session back into the working space"
                          >
                            <Undo2 className="w-3.5 h-3.5" /> Load Draft Text
                          </button>

                          <button
                            onClick={handleCopyLogReport}
                            className={`px-3 py-1.5 rounded text-[10px] font-bold uppercase cursor-pointer select-none transition-all flex items-center gap-1.5 ${
                              logReportCopied
                                ? 'bg-emerald-600 text-white'
                                : theme === 'dark'
                                  ? 'bg-zinc-850 text-zinc-100 hover:bg-zinc-805'
                                  : 'bg-zinc-950 text-white hover:bg-zinc-850'
                            }`}
                          >
                            {logReportCopied ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            {logReportCopied ? 'Report Copied!' : 'Copy Summary Report'}
                          </button>
                        </div>
                      </div>

                      {/* Score metrics grid */}
                      <div className={`grid grid-cols-2 sm:grid-cols-5 gap-4 p-4 rounded-lg border text-center font-mono uppercase tracking-wider text-xs shrink-0 ${
                        theme === 'dark' ? 'bg-[#18181F] border-zinc-805 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-650'
                      }`}>
                        <div>
                          <span className="text-[9px] text-zinc-400 block mb-0.5">Identified Suggestions</span>
                          <span className={`text-sm font-bold ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'}`}>{selectedLog.totalSuggestions}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-emerald-500 block mb-0.5">Accepted Corrections</span>
                          <span className="text-sm font-bold text-emerald-500">{selectedLog.acceptedCount}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-zinc-500 block mb-0.5">Ignored Recommendations</span>
                          <span className="text-sm font-bold text-zinc-500">{selectedLog.ignoredCount}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-zinc-400 block mb-0.5">Total Word Count</span>
                          <span className={`text-sm font-bold ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'}`}>{selectedLog.wordCount} Words</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-blue-500 block mb-0.5">Accepted / 100 Words</span>
                          <span className="text-sm font-bold text-blue-500">
                            {(selectedLog.wordCount > 0 ? (selectedLog.acceptedCount / selectedLog.wordCount) * 100 : 0).toFixed(1)}
                          </span>
                        </div>
                      </div>

                      {/* Visual segment progress bar */}
                      {(() => {
                        const totalSugg = selectedLog.totalSuggestions;
                        const accCount = selectedLog.acceptedCount;
                        const ignCount = selectedLog.ignoredCount;
                        const pendCount = selectedLog.pendingCount || 0;
                        const acceptedRate = totalSugg > 0 ? Math.round((accCount / totalSugg) * 100) : 100;
                        
                        const acceptedPct = totalSugg > 0 ? (accCount / totalSugg) * 100 : 100;
                        const ignoredPct = totalSugg > 0 ? (ignCount / totalSugg) * 100 : 0;
                        const pendingPct = totalSugg > 0 ? (pendCount / totalSugg) * 100 : 0;

                        return (
                          <div className={`p-4 rounded-lg border flex flex-col gap-2 shrink-0 ${
                            theme === 'dark' ? 'bg-[#15151C] border-zinc-805/40' : 'bg-[#FAF9F6] border-zinc-200'
                          }`}>
                            <div className="flex justify-between items-center text-[10px] font-mono uppercase font-bold tracking-wider">
                              <span className="text-zinc-500">Session Acceptance Performance</span>
                              <span className={acceptedRate >= 70 ? 'text-emerald-500' : acceptedRate >= 40 ? 'text-amber-500' : 'text-red-500'}>
                                {acceptedRate}% Revisions Applied
                              </span>
                            </div>
                            
                            <div className="w-full h-3 bg-zinc-200 dark:bg-zinc-850 rounded-full overflow-hidden flex">
                              {totalSugg > 0 ? (
                                <>
                                  <div
                                    style={{ width: `${acceptedPct}%` }}
                                    className="h-full bg-emerald-600 transition-all rounded-l-sm"
                                    title={`Accepted: ${accCount}`}
                                  />
                                  <div
                                    style={{ width: `${ignoredPct}%` }}
                                    className="h-full bg-zinc-500 transition-all"
                                    title={`Ignored: ${ignCount}`}
                                  />
                                  <div
                                    style={{ width: `${pendingPct}%` }}
                                    className="h-full bg-amber-500 transition-all rounded-r-sm"
                                    title={`Pending: ${pendCount}`}
                                  />
                                </>
                              ) : (
                                <div className="w-full h-full bg-emerald-600 rounded-full" title="Perfect quality review" />
                              )}
                            </div>

                            <div className="flex items-center justify-between text-[9px] font-mono uppercase text-zinc-400">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 bg-emerald-600 rounded-sm inline-block" /> Accepted ({accCount})
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 bg-zinc-500 rounded-sm inline-block" /> Ignored ({ignCount})
                              </span>
                              {pendCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-2 h-2 bg-amber-500 rounded-sm inline-block" /> Pending ({pendCount})
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Specific Suggestion Audit Trail */}
                      {(() => {
                        const suggestionsList = selectedLog.suggestions || parseSuggestionsFromMarkdown(selectedLog.reportMarkdown);
                        if (suggestionsList.length === 0) return null;

                        return (
                          <div className={`p-4 rounded-lg border flex flex-col gap-3 shrink-0 ${
                            theme === 'dark' ? 'bg-[#15151C] border-zinc-805/40' : 'bg-[#FAF9F6] border-zinc-200'
                          }`}>
                            <div className="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider flex items-center justify-between">
                              <span>Specific Suggestions Audit Trail</span>
                              <span className="text-[9px] lowercase font-normal italic">
                                {selectedLog.suggestions ? 'raw database snapshot' : 'reconstructed from markdown report'}
                              </span>
                            </div>
                            
                            <div className="flex flex-col gap-2.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                              {suggestionsList.map((item, idx) => {
                                const isAcc = item.status === 'accepted';
                                const isIgn = item.status === 'rejected';
                                const isPend = item.status === 'pending' || !item.status;

                                return (
                                  <div
                                    key={idx}
                                    className={`p-3 rounded border flex flex-col gap-2 text-xs font-sans leading-relaxed ${
                                      theme === 'dark' 
                                        ? 'bg-[#121214] border-zinc-800' 
                                        : 'bg-white border-zinc-200 shadow-sm'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                                        isAcc 
                                          ? 'bg-emerald-600/15 text-emerald-500 border border-emerald-500/20' 
                                          : isIgn 
                                            ? 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/20' 
                                            : 'bg-amber-500/15 text-amber-500 border border-amber-500/20'
                                      }`}>
                                        {isAcc ? 'Accepted' : isIgn ? 'Ignored' : 'Pending'}
                                      </span>
                                      <span className="text-[10px] font-mono font-bold text-zinc-400">
                                        Rule: {item.rule}
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                                      <div className={`p-2 rounded ${theme === 'dark' ? 'bg-zinc-900/50' : 'bg-zinc-50'}`}>
                                        <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5 font-mono">Original Text</span>
                                        <p className="m-0 select-text font-serif italic text-zinc-450 dark:text-zinc-400">"{item.original}"</p>
                                      </div>
                                      <div className={`p-2 rounded ${theme === 'dark' ? 'bg-zinc-900/50' : 'bg-zinc-50'}`}>
                                        <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5 font-mono">
                                          {isAcc ? 'Corrected To' : 'Suggested Fix'}
                                        </span>
                                        <p className={`m-0 select-text font-serif ${isAcc ? 'text-emerald-500 font-semibold' : 'text-zinc-500'}`}>
                                          "{item.fix || '(Omitted/Deleted)'}"
                                        </p>
                                      </div>
                                    </div>

                                    <div className="text-[11px] opacity-90 pl-1">
                                      <span className="font-bold text-zinc-400 font-mono text-[9px] uppercase tracking-wider">Explanation: </span>
                                      <span className={theme === 'dark' ? 'text-zinc-350' : 'text-zinc-700'}>{item.issue}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Full markdown output block */}
                      <div className="flex-grow flex flex-col min-h-0">
                        <span className="text-[10px] uppercase font-bold text-gray-400 mb-2 block font-mono">Locked Editorial Report Markdown Output</span>
                        <textarea
                          readOnly
                          value={selectedLog.reportMarkdown}
                          className={`w-full flex-grow p-4 min-h-[220px] font-mono text-xs leading-relaxed border rounded-lg resize-none ${
                            theme === 'dark' 
                              ? 'bg-[#0E0E10] border-zinc-800 text-zinc-300' 
                              : 'bg-zinc-50 border-zinc-200 text-zinc-800'
                          }`}
                          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Modal Footer */}
            <div className={`p-4 border-t flex justify-end shrink-0 gap-2 ${
              theme === 'dark' ? 'border-zinc-850 bg-zinc-900/40' : 'border-zinc-100 bg-zinc-50'
            }`}>
              <button
                onClick={() => setShowLogsModal(false)}
                className={`px-5 py-2 border rounded-lg text-xs font-bold uppercase cursor-pointer transition-all ${
                  theme === 'dark'
                    ? 'border-zinc-800 text-zinc-250 bg-zinc-900 hover:bg-zinc-800'
                    : 'border-zinc-200 text-zinc-700 bg-white hover:bg-zinc-100 shadow-sm'
                }`}
              >
                Close Logs History
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Shared Compliance Discrepancy Database (Tune-In Corpus) Modal */}
      {showDbLogsModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`w-full max-w-5xl h-[85vh] rounded-xl flex flex-col overflow-hidden shadow-2xl border ${
              theme === 'dark' ? 'bg-[#121214] border-zinc-805 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            {/* Modal Header */}
            <div className={`p-6 border-b flex justify-between items-center shrink-0 ${
              theme === 'dark' ? 'border-zinc-850 bg-zinc-900/60' : 'border-zinc-100 bg-zinc-50'
            }`}>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider font-sans m-0 flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#0055FF] animate-pulse" /> Shared Discrepancy Database
                </h3>
                <p className={`text-xs mt-1 uppercase tracking-wider font-mono ${
                  theme === 'dark' ? 'text-zinc-500' : 'text-zinc-650'
                }`}>
                  Persistent audit trail of human-corrected style deviations for AI fine-tuning.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={downloadDbLogsJson}
                  disabled={dbLogs.length === 0}
                  className={`px-2.5 py-1.5 border text-[10px] font-bold uppercase tracking-wider rounded select-none transition-all flex items-center gap-1.5 ${
                    dbLogs.length === 0
                      ? 'opacity-40 cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800'
                      : theme === 'dark'
                        ? 'border-blue-500/30 text-blue-455 hover:bg-blue-600/15 cursor-pointer'
                        : 'border-blue-200 bg-blue-50/50 text-blue-750 hover:bg-blue-100 cursor-pointer'
                  }`}
                  title={dbLogs.length === 0 ? "No history logs to download" : "Download fine-tuning standard corpus database as JSON"}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Corpus
                </button>
                {dbLogs.length > 0 && (
                  <button
                    onClick={handleClearDbLogs}
                    className={`px-2.5 py-1.5 border text-[10px] font-bold uppercase tracking-wider rounded select-none cursor-pointer transition-all ${
                      isConfirmingClearDb
                        ? 'bg-red-600 border-red-650 text-white animate-pulse'
                        : 'border-red-500/30 text-red-500 hover:bg-red-500/10'
                    }`}
                    title={isConfirmingClearDb ? "Click again to confirm deleting all database logs" : "Clear database logs completely"}
                  >
                    {isConfirmingClearDb ? "Confirm Clear DB?" : "Clear DB Logs"}
                  </button>
                )}
                <button
                  onClick={() => setShowDbLogsModal(false)}
                  className={`p-1.5 rounded-full border transition-all hover:bg-zinc-100/10 cursor-pointer ${
                    theme === 'dark' ? 'border-zinc-800 text-zinc-400 hover:text-zinc-100' : 'border-zinc-200 text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content view space */}
            <div className={`flex-grow overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar ${theme === 'dark' ? 'bg-[#0E0E10]/40' : 'bg-[#FAF9F6]/30'}`}>
                        {/* Cloud Database Connection Health Banner */}
              {isServerWaking ? (
                <div className={`p-4 rounded-lg border text-xs font-sans flex flex-col gap-2 shrink-0 ${
                  theme === 'dark' 
                    ? 'bg-amber-950/20 border-amber-900/40 text-amber-300' 
                    : 'bg-amber-50 border-amber-100 text-amber-850 shadow-sm'
                }`}>
                  <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px] text-amber-650 dark:text-amber-400">
                    <RefreshCw className="w-4 h-4 shrink-0 text-amber-500 animate-spin" />
                    <span>Database Status: Connecting (Waking Shared Cloud Server)</span>
                  </div>
                  <p className="leading-relaxed text-[11px] opacity-90">
                    The Cloud Run workspace container is waking up from static standby mode. Any visiting colleague will automatically trigger this initial container warm-up. Resolving API routes and synchronizing cloud data stream...
                    {retryCount > 0 && <span className="font-bold block mt-1">(Retrying handshake attempt {retryCount}/6...)</span>}
                  </p>
                </div>
              ) : dbError ? (
                <div className={`p-4 rounded-lg border text-xs font-sans flex flex-col gap-2 shrink-0 ${
                  theme === 'dark' 
                    ? 'bg-red-955/20 border-red-900/40 text-red-300' 
                    : 'bg-red-50 border-red-100 text-red-850 shadow-sm'
                }`}>
                  <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px] text-red-650 dark:text-red-400">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                    <span>Database Connected Status: FAIL (Using Fallback Offline Cache)</span>
                  </div>
                  <p className="leading-relaxed text-[11px] opacity-90">
                    Failed to query the corporate Shared Discrepancy Database in the cloud. We are currently falling back to localized ephemeral storage on this Cloud Run sandbox. 
                    <strong className="block mt-1">⚠️ Warning: Because other shared colleagues reside in separate sandbox containers, they will NOT see changes or logs created in offline fallback mode.</strong>
                  </p>
                  <div className="bg-black/20 dark:bg-black/40 p-2.5 rounded font-mono text-[10px] whitespace-pre-wrap select-all border border-black/15 max-h-24 overflow-y-auto mt-1">
                    Error Log: {dbError}
                  </div>
                  {dbParams && (
                    <div className="text-[10px] uppercase font-mono tracking-wider opacity-75 mt-1 flex flex-wrap gap-x-4">
                      <span>• Target Project: <span className="underline">{dbParams.projectId || 'Unknown'}</span></span>
                      <span>• Target Database: <span className="underline">{dbParams.databaseId || '(default)'}</span></span>
                    </div>
                  )}
                  <button
                    onClick={() => wakeAndFetchDb(1, 12)}
                    className="mt-2 self-start px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] uppercase font-bold tracking-wider transition-all cursor-pointer flex items-center gap-1.5 border-none"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Wake Server & Sync DB
                  </button>
                </div>
              ) : (
                <div className={`p-3 rounded-lg border text-xs font-sans flex items-center justify-between shrink-0 ${
                  theme === 'dark' 
                    ? 'bg-emerald-950/10 border-emerald-900/30 text-emerald-300' 
                    : 'bg-emerald-50/50 border-emerald-100 text-emerald-850 shadow-sm'
                }`}>
                  <div className="flex items-center gap-2 font-semibold uppercase tracking-wider text-[9px] text-emerald-600 dark:text-emerald-400">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-450 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span>Database Status: Shared Cloud Connected & Synchronized</span>
                  </div>
                  {dbParams && (
                    <span className="text-[9px] font-mono uppercase tracking-wider opacity-75 hidden sm:inline">
                      Firestore Pool: {dbParams.projectId} / {dbParams.databaseId}
                    </span>
                  )}
                </div>
              )}

              {dbLogsLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-zinc-500 text-xs font-mono uppercase">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                  Syncing database records from Firestore...
                </div>
              ) : dbLogs.length === 0 ? (
                <div className="py-24 flex flex-col items-center justify-center text-center p-6 gap-3 border border-dashed rounded-lg border-zinc-500/20">
                  <Database className="w-10 h-10 text-zinc-400 opacity-70" />
                  <p className={`text-xs uppercase tracking-wider font-bold ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-650'}`}>No database logs found</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 leading-normal max-w-sm">
                    No discrepancies have been logged in Firestore yet. Activate the 'Sub-Editor Audit' tab and press 'Log Final Subbed Version' under any human finalized article draft to populate the shared feedback corpus.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {/* Summary Metrics */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 font-mono">
                    <div className={`p-4 rounded-lg border flex flex-col ${
                      theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-805' : 'bg-white border-zinc-200 shadow-sm'
                    }`}>
                      <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Total Logs Stored</span>
                      <span className="text-xl font-black text-zinc-850 dark:text-zinc-200">{dbLogs.length} Entries</span>
                    </div>
                    <div className={`p-4 rounded-lg border flex flex-col ${
                      theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-805' : 'bg-white border-zinc-200 shadow-sm'
                    }`}>
                      <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Avg Core Accuracy Score</span>
                      <span className="text-xl font-black text-blue-600 dark:text-blue-450">
                        {Math.round(dbLogs.reduce((acc, log) => acc + (log.accuracyScore || 0), 0) / dbLogs.length)}%
                      </span>
                    </div>
                    <div className={`p-4 rounded-lg border flex flex-col ${
                      theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-805' : 'bg-white border-zinc-200 shadow-sm'
                    }`}>
                      <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Total Gaps Tracked</span>
                      <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                        {dbLogs.reduce((acc, log) => acc + (log.missedInfractions?.length || 0), 0)} Gaps
                      </span>
                    </div>
                    <div className={`p-4 rounded-lg border flex flex-col ${
                      theme === 'dark' ? 'bg-[#18181c]/60 border-zinc-805' : 'bg-white border-zinc-200 shadow-sm'
                    }`}>
                      <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Total Alignments Met</span>
                      <span className="text-xl font-black text-amber-600 dark:text-amber-400">
                        {dbLogs.reduce((acc, log) => acc + (log.correctAdherences?.length || 0), 0)} Correct
                      </span>
                    </div>
                  </div>

                  {/* Logs List Container */}
                  <div className="flex flex-col gap-4">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-400 font-mono">Telemetry Entry Stream:</span>
                    <div className="flex flex-col gap-3">
                      {dbLogs.map((log) => {
                        const isExpanded = expandedDbLogId === log.id;
                        let dateStr = log.timestamp;
                        let timeStr = '';
                        const d = new Date(log.timestamp);
                        if (!isNaN(d.getTime())) {
                          dateStr = d.toLocaleDateString('en-AU');
                          timeStr = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
                        }
                        
                        let evaluatedStr = '';
                        if (log.lastEvaluatedAt) {
                          const eD = new Date(log.lastEvaluatedAt);
                          if (!isNaN(eD.getTime())) {
                            evaluatedStr = ` • Evaluated: ${eD.toLocaleDateString('en-AU')} @ ${eD.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
                          }
                        }
                        
                        // Color code scores
                        const scoreColor = 'text-blue-500 border-blue-500/20 bg-blue-500/10';

                        return (
                          <div 
                            key={`modal-${log.id}`}
                            className={`rounded-lg border transition-all ${
                              theme === 'dark'
                                ? 'border-zinc-850 bg-[#17171a]/50 hover:bg-[#17171a]'
                                : 'border-zinc-200 bg-white hover:bg-zinc-50 shadow-sm'
                            }`}
                          >
                            {/* Entry Header */}
                            <div 
                              onClick={() => setExpandedDbLogId(isExpanded ? null : log.id)}
                              className="p-4 flex items-center justify-between gap-4 cursor-pointer select-none"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className={`text-xs font-mono font-black border px-2 py-0.5 rounded shrink-0 ${scoreColor}`}>
                                  {log.accuracyScore}%
                                </span>
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate">
                                    {log.alignmentGap ? log.alignmentGap : 'No prominent copy editorial gaps found.'}
                                  </span>
                                  <span className="text-[9px] font-mono text-zinc-400/85 uppercase mt-0.5">
                                    {dateStr} @ {timeStr} • {log.missedInfractions?.length || 0} style gaps logged • {log.correctAdherences?.length || 0} correct{evaluatedStr}
                                  </span>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={(e) => handleReEvaluateLog(log.id, e)}
                                  disabled={reEvaluatingLogId !== null}
                                  className={`p-1.5 transition-colors rounded cursor-pointer ${
                                    reEvaluatingLogId === log.id
                                      ? 'text-emerald-500 bg-emerald-500/10'
                                      : 'text-zinc-500 hover:text-emerald-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                  }`}
                                  title="Retroactively Re-evaluate Alignment & calculate correct alignments"
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${reEvaluatingLogId === log.id ? 'animate-spin text-emerald-500' : ''}`} />
                                </button>

                                <button 
                                  onClick={(e) => handleDeleteDbLog(log.id, e)}
                                  className={`p-1.5 transition-colors rounded cursor-pointer ${
                                    deletingDbLogId === log.id 
                                      ? 'text-white bg-red-650 font-bold px-2 py-0.5 text-[9px] rounded animate-pulse' 
                                      : 'text-zinc-500 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                  }`}
                                  title={deletingDbLogId === log.id ? "Click again to confirm delete" : "Delete entry"}
                                >
                                  {deletingDbLogId === log.id ? (
                                    "DELETE?"
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <span className="text-zinc-450">
                                  {isExpanded ? (
                                    <ChevronRight className="w-4 h-4 rotate-270 transform transition-transform" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 rotate-90 transform transition-transform" />
                                  )}
                                </span>
                              </div>
                            </div>

                            {/* Expanded Body */}
                            {isExpanded && (
                              <div className="p-4 pt-2 border-t border-zinc-200/40 dark:border-zinc-800/60 flex flex-col gap-4 animate-fadeIn">
                                {/* Texts Preview */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1 text-xs leading-relaxed font-serif">
                                  <div className={`p-3 rounded border flex flex-col gap-1 ${
                                    theme === 'dark' ? 'bg-[#0f0f12] border-zinc-800' : 'bg-zinc-50/50 border-zinc-150'
                                  }`}>
                                    <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase">Original copy:</span>
                                    <p className="text-zinc-450 dark:text-zinc-400 italic line-clamp-4">"{log.originalCopy}"</p>
                                  </div>
                                  <div className={`p-3 rounded border flex flex-col gap-1 ${
                                    theme === 'dark' ? 'bg-[#0f0f12] border-zinc-800' : 'bg-zinc-50/50 border-zinc-150'
                                  }`}>
                                    <span className="text-[9px] font-mono font-bold text-blue-500 uppercase">Human finalized final masterpiece:</span>
                                    <p className="text-zinc-800 dark:text-zinc-200 font-bold line-clamp-4">"{log.humanFinalized}"</p>
                                  </div>
                                </div>

                                {/* Actionable summary */}
                                {log.fineTuningActionable && (
                                  <div className="text-xs">
                                    <span className="text-[9px] uppercase font-bold text-zinc-500 font-mono">Fine-Tuning Recommendation:</span>
                                    <p className="text-zinc-750 dark:text-zinc-300 italic font-serif mt-1 bg-blue-50/20 dark:bg-blue-950/10 p-2.5 rounded border border-blue-500/10">{log.fineTuningActionable}</p>
                                  </div>
                                )}

                                {/* Missed Infractions List */}
                                {log.missedInfractions && log.missedInfractions.length > 0 && (
                                  <div className="flex flex-col gap-2.5">
                                    <span className="text-[9px] font-mono uppercase font-semibold text-zinc-400">Logged Infraction Details ({log.missedInfractions.length})</span>
                                    <div className="flex flex-col gap-2">
                                      {log.missedInfractions.map((inf: any, infIdx: number) => (
                                        <div 
                                          key={`inf-${infIdx}`}
                                          className={`p-3 rounded border text-xs flex flex-col gap-2 ${
                                            theme === 'dark' ? 'bg-[#18181c]/40 border-zinc-800/60' : 'bg-zinc-150/10 border-zinc-200/50'
                                          }`}
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-[9px] font-mono font-bold uppercase py-0.5 px-1.5 bg-blue-500/10 text-blue-550 dark:text-blue-400 rounded border border-blue-500/20">
                                              {inf.rule}
                                            </span>
                                            <span className="text-[9px] font-mono text-zinc-550 dark:text-zinc-450 uppercase">
                                              Register: {inf.targetGuide || 'editorial'}
                                            </span>
                                          </div>
                                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[9px] mt-1 text-zinc-500">
                                            <div>AI missed: <span className="text-red-500 line-through">"{inf.original}"</span></div>
                                            <div>Human final: <span className="text-emerald-600 dark:text-emerald-400 font-bold">"{inf.human}"</span></div>
                                            <div>AI generated: <span className="text-zinc-450 font-bold">"{inf.ai || '(No correction)'}"</span></div>
                                          </div>
                                          <div className="text-xs italic text-zinc-650 dark:text-zinc-400 mt-1 font-serif">
                                            {inf.explanation}
                                          </div>
                                          <div className="space-y-0.5 mt-1 border-t pt-1.5 border-zinc-200/50 dark:border-zinc-800/65">
                                            <span className="text-[8px] tracking-wide uppercase text-blue-500 block">Fine-Tuning Register Patch:</span>
                                            <code className="text-[10px] font-mono block bg-[#0c0c0e] text-zinc-300 dark:text-zinc-200 p-2 rounded font-medium select-all border border-zinc-800/35">
                                              {inf.fineTuningPatch}
                                            </code>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Correct Adherences List */}
                                {log.correctAdherences && log.correctAdherences.length > 0 && (
                                  <div className="flex flex-col gap-2.5 mt-2 pt-2 border-t border-zinc-200/40 dark:border-zinc-800/60">
                                    <span className="text-[9px] font-mono uppercase font-semibold text-emerald-500">Correct Alignments ({log.correctAdherences.length})</span>
                                    <div className="flex flex-col gap-2">
                                      {log.correctAdherences.map((adh: any, adhIdx: number) => (
                                        <div 
                                          key={adhIdx}
                                          className={`p-3 rounded border text-xs flex flex-col gap-2 ${
                                            theme === 'dark' ? 'bg-[#18181c]/40 border-zinc-800/60' : 'bg-emerald-50/10 border-emerald-250/30'
                                          }`}
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-[9px] font-mono font-bold uppercase py-0.5 px-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded border border-emerald-500/20">
                                              {adh.rule}
                                            </span>
                                          </div>
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[9px] mt-1 text-zinc-500">
                                            <div>Original copy: <span className="text-zinc-450">"{adh.original}"</span></div>
                                            <div>Aligned styling: <span className="text-emerald-600 dark:text-emerald-400 font-bold">"{adh.corrected}"</span></div>
                                          </div>
                                          <div className="text-xs italic text-zinc-650 dark:text-zinc-400 mt-1 font-serif">
                                            {adh.explanation}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className={`p-4 border-t flex justify-end shrink-0 gap-2 ${
              theme === 'dark' ? 'border-zinc-850 bg-zinc-900/40' : 'border-zinc-100 bg-zinc-50'
            }`}>
              <button
                onClick={() => setShowDbLogsModal(false)}
                className={`px-5 py-2 border rounded-lg text-xs font-bold uppercase cursor-pointer transition-all ${
                  theme === 'dark'
                    ? 'border-zinc-800 text-zinc-250 bg-zinc-900 hover:bg-zinc-800'
                    : 'border-zinc-200 text-zinc-700 bg-white hover:bg-zinc-100 shadow-sm'
                }`}
              >
                Close Database Viewer
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Dynamic Authorized Users Management Catalog / Directory (Admin Only) */}
      {showUserDirectory && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`w-full max-w-4xl h-[80vh] rounded-xl flex flex-col overflow-hidden shadow-2xl border ${
              theme === 'dark' ? 'bg-[#121214] border-zinc-805 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            {/* Header */}
            <div className={`p-6 border-b flex justify-between items-center shrink-0 ${
              theme === 'dark' ? 'border-zinc-850 bg-zinc-900/60' : 'border-zinc-100 bg-zinc-50'
            }`}>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider font-sans m-0 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" /> Whitelisted Editorial Directory
                </h3>
                <p className={`text-[10px] mt-1 uppercase tracking-wider font-mono ${
                  theme === 'dark' ? 'text-zinc-500' : 'text-zinc-650'
                }`}>
                  Whitelists approved email accounts and controls administrator levels.
                </p>
              </div>
              <button
                onClick={() => setShowUserDirectory(false)}
                className={`p-1.5 rounded-full border transition-all hover:bg-zinc-100/10 cursor-pointer ${
                  theme === 'dark' ? 'border-zinc-800 text-zinc-400 hover:text-zinc-100' : 'border-zinc-200 text-zinc-500 hover:text-zinc-900'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inner Content panels */}
            <div className="flex-grow overflow-y-auto p-6 flex flex-col md:flex-row gap-6 custom-scrollbar">
              
              {/* Form invite (Left Panel) */}
              <div className="w-full md:w-1/3 shrink-0 flex flex-col gap-4">
                <div className={`p-5 rounded-lg border ${
                  theme === 'dark' ? 'bg-[#18181c]/50 border-zinc-800' : 'bg-zinc-50 border-zinc-200 shadow-sm'
                }`}>
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-400 block mb-3">Invite/Whitelist Editor</span>
                  
                  <form onSubmit={handleAddUser} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-550 dark:text-zinc-455 block font-bold">BUSINESS EMAIL</label>
                      <input
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="journalist@broadsheet.com.au"
                        className={`w-full px-3 py-2 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 ${
                          theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-205 text-zinc-900'
                        }`}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-550 dark:text-zinc-455 block font-bold">ROLES ASSIGNMENT</label>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'admin' | 'sub-editor' | 'editor')}
                        className={`w-full px-3 py-2 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 ${
                          theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-205 text-zinc-900'
                        }`}
                      >
                        <option value="editor">Editor (Verify Copy only)</option>
                        <option value="sub-editor">Sub-editor (Verify Copy + Cross-check / Audit)</option>
                        <option value="admin">Administrator (Full permissions)</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold uppercase transition duration-200 active:translate-y-0.5 cursor-pointer"
                    >
                      Grant Access
                    </button>
                  </form>
                </div>

                {userDirSuccess && (
                  <div className="p-3 bg-[#EBFDF5] dark:bg-emerald-950/15 text-emerald-800 dark:text-emerald-400 border border-emerald-250 dark:border-emerald-950/30 text-xs rounded leading-relaxed">
                    {userDirSuccess}
                  </div>
                )}

                {userDirError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/15 text-red-800 dark:text-red-400 border border-red-250 dark:border-[#7F1D1D]/30 text-xs rounded leading-relaxed">
                    {userDirError}
                  </div>
                )}
              </div>

              {/* Grid / Directory List (Right Panel) */}
              <div className="flex-grow flex flex-col gap-3">
                <span className="text-[10px] font-mono font-bold uppercase text-zinc-400 block pb-1 border-b border-zinc-200/50 dark:border-zinc-800/50">Whitelisted Corporate Users ({usersList.length})</span>
                
                {usersLoading ? (
                  <div className="flex-grow flex flex-col items-center justify-center text-xs font-mono text-zinc-500 py-12 gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                    Querying credentials list...
                  </div>
                ) : usersList.length === 0 ? (
                  <div className="flex-grow flex flex-col items-center justify-center text-zinc-500 border border-dashed rounded p-12 text-center text-xs">
                    No authorized email records found.
                  </div>
                ) : (
                  <div className="flex-grow overflow-y-auto max-h-[50vh] flex flex-col gap-2.5 pr-1.5 custom-scrollbar">
                    {usersList.map((usr: any, uidx) => {
                      const isOwnerSeed = usr.email.toLowerCase() === 'james.harrison@broadsheet.com.au';
                      return (
                        <div
                          key={`usr-${uidx}`}
                          className={`p-3.5 border rounded-lg flex items-center justify-between gap-4 ${
                            theme === 'dark' ? 'bg-[#18181c]/40 border-zinc-805' : 'bg-white border-zinc-150 shadow-sm'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold leading-normal text-zinc-800 dark:text-zinc-200 break-all select-all font-mono">
                                {usr.email}
                              </span>
                              {isOwnerSeed && (
                                <span className="text-[8px] tracking-wider uppercase font-extrabold px-1 dark:bg-zinc-800 border bg-zinc-100 text-[#0055FF] dark:text-blue-400 rounded">
                                  Owner
                                </span>
                              )}
                            </div>
                            <span className="text-[9px] font-mono text-zinc-500 uppercase block mt-1 dark:text-zinc-400">
                              Whitelisted: {new Date(usr.invitedAt).toLocaleDateString()} by {usr.invitedBy || 'seed'}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            {/* Toggle role selector */}
                            <select
                              disabled={isOwnerSeed}
                              value={usr.role}
                              onChange={(e) => handleUpdateUserStatus(usr.email, e.target.value, usr.status)}
                              className={`p-1 border rounded text-[10px] font-mono uppercase bg-transparent outline-none focus:ring-1 focus:ring-zinc-900 ${
                                theme === 'dark' ? 'border-zinc-800 text-zinc-305' : 'border-zinc-250 text-zinc-705'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              <option value="editor">Editor</option>
                              <option value="sub-editor">Sub-editor</option>
                              <option value="admin">Admin</option>
                            </select>

                            {/* Status toggling */}
                            <select
                              disabled={isOwnerSeed}
                              value={usr.status}
                              onChange={(e) => handleUpdateUserStatus(usr.email, usr.role, e.target.value)}
                              className={`p-1 border rounded text-[10px] font-mono uppercase bg-transparent outline-none focus:ring-1 focus:ring-zinc-900 ${
                                usr.status === 'active'
                                  ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                                  : 'text-zinc-500 border-zinc-650'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>

                            {/* Revoke Permission */}
                            <button
                              disabled={isOwnerSeed}
                              onClick={() => {
                                if (confirmDeleteEmail === usr.email) {
                                  handleDeleteUser(usr.email);
                                  setConfirmDeleteEmail(null);
                                } else {
                                  setConfirmDeleteEmail(usr.email);
                                }
                              }}
                              className={`p-1 px-2 text-[10px] font-bold uppercase transition rounded disabled:opacity-30 disabled:cursor-not-allowed border-none cursor-pointer ${
                                confirmDeleteEmail === usr.email
                                  ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
                                  : 'bg-red-50 hover:bg-red-100 dark:bg-red-95/20 dark:hover:bg-red-900/30 text-red-650 dark:text-red-400'
                              }`}
                              title={confirmDeleteEmail === usr.email ? "Click again to confirm revocation" : "Revoke whitelisting"}
                            >
                              {confirmDeleteEmail === usr.email ? "Confirm Revoke" : "Revoke"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>

            </div>

            {/* Footer */}
            <div className={`p-4 border-t flex justify-between items-center shrink-0 ${
              theme === 'dark' ? 'border-zinc-850 bg-zinc-900/40' : 'border-zinc-100 bg-zinc-50'
            }`}>
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-500 uppercase">
                <Lock className="w-3.5 h-3.5" /> Secure Corporate User Registry Integration
              </div>
              <button
                onClick={() => setShowUserDirectory(false)}
                className={`px-5 py-2 border rounded-lg text-xs font-bold uppercase cursor-pointer transition-all ${
                  theme === 'dark'
                    ? 'border-zinc-850 text-zinc-250 bg-zinc-900 hover:bg-zinc-800'
                    : 'border-zinc-200 text-zinc-700 bg-white hover:bg-[#F4F4F5] shadow-sm'
                }`}
              >
                Close Directory Panel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* User Feedback Modal */}
      {showFeedbackModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className={`max-w-2xl w-full border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              theme === 'dark' ? 'bg-[#121214] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            {/* Header */}
            <div className={`p-5 border-b flex items-center justify-between shrink-0 ${
              theme === 'dark' ? 'border-zinc-800 bg-[#18181b]' : 'border-zinc-150 bg-zinc-50'
            }`}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-[#0055FF]/10 text-[#0055FF] rounded-lg">
                  <MessageSquarePlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base tracking-tight m-0">Tool Feedback &amp; Ideas</h3>
                  <p className="text-[11px] text-zinc-500 font-mono m-0 mt-0.5">
                    Share feature requests, UX ideas, or recurring AI errors
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowFeedbackModal(false)}
                className="p-1.5 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body Form */}
            <form onSubmit={handleSubmitFeedback} className="p-6 space-y-5 overflow-y-auto">
              {feedbackSuccess ? (
                <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-xl text-center space-y-3">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
                  <h4 className="font-bold text-emerald-900 dark:text-emerald-100 text-base m-0">Thank You for Your Feedback!</h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 m-0">
                    Your response has been stored in the team database and will be reviewed by the engineering team.
                  </p>
                </div>
              ) : (
                <>
                  {feedbackError && (
                    <div className="p-3.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 text-xs rounded-lg flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                      <span>{feedbackError}</span>
                    </div>
                  )}

                  {/* Category Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 block">
                      Feedback Type
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                      {[
                        { id: 'idea', label: '💡 Idea / Feature', desc: 'New capabilities' },
                        { id: 'ux_request', label: '🎨 UX Request', desc: 'UI & layout polish' },
                        { id: 'ai_error', label: '🤖 AI Error', desc: 'Missed rules / hallucinations' },
                        { id: 'general', label: '💬 General', desc: 'General thoughts' }
                      ].map((cat) => {
                        const isSelected = feedbackCategory === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setFeedbackCategory(cat.id as any)}
                            className={`p-3 text-left rounded-xl border-2 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-[#0055FF] bg-blue-50 dark:bg-blue-950/70 shadow-sm ring-2 ring-blue-500/20'
                                : theme === 'dark'
                                  ? 'border-zinc-800 hover:border-zinc-700 bg-[#18181b]'
                                  : 'border-zinc-200 hover:border-zinc-300 bg-white'
                            }`}
                          >
                            <div className={`text-xs font-bold ${
                              isSelected
                                ? 'text-[#0055FF] dark:text-blue-300'
                                : theme === 'dark'
                                  ? 'text-zinc-100'
                                  : 'text-zinc-900'
                            }`}>
                              {cat.label}
                            </div>
                            <div className={`text-[11px] font-medium mt-0.5 ${
                              isSelected
                                ? 'text-blue-950 dark:text-blue-200'
                                : theme === 'dark'
                                  ? 'text-zinc-400'
                                  : 'text-zinc-600'
                            }`}>
                              {cat.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Summary Title */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 block">
                      Summary Title
                    </label>
                    <input
                      type="text"
                      required
                      value={feedbackTitle}
                      onChange={(e) => setFeedbackTitle(e.target.value)}
                      placeholder="e.g., Add dark mode toggle in toolbar or AI constantly flags 'Hot List' wrongly"
                      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm outline-none transition focus:ring-2 focus:ring-[#0055FF]/30 focus:border-[#0055FF] ${
                        theme === 'dark'
                          ? 'bg-[#18181c] border-zinc-800 text-zinc-100 placeholder-zinc-500'
                          : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500 shadow-sm'
                      }`}
                    />
                  </div>

                  {/* Priority */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 block">
                      Priority / Urgency
                    </label>
                    <div className="flex items-center gap-2">
                      {[
                        { id: 'low', label: 'Low' },
                        { id: 'medium', label: 'Medium' },
                        { id: 'high', label: 'High' },
                        { id: 'critical', label: 'Critical / Blocker' }
                      ].map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setFeedbackPriority(p.id as any)}
                          className={`px-3 py-1.5 rounded-md border text-xs font-semibold cursor-pointer transition ${
                            feedbackPriority === p.id
                              ? p.id === 'critical'
                                ? 'bg-red-600 border-red-700 text-white'
                                : p.id === 'high'
                                  ? 'bg-amber-600 border-amber-700 text-white'
                                  : 'bg-[#0055FF] border-blue-600 text-white'
                              : theme === 'dark'
                                ? 'bg-[#18181b] border-zinc-800 text-zinc-300 hover:text-zinc-100'
                                : 'bg-zinc-100 border-zinc-300 text-zinc-800 hover:bg-zinc-200 hover:text-zinc-950'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Detailed Explanation */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 block">
                      Detailed Feedback / Steps / Request
                    </label>
                    <textarea
                      required
                      rows={5}
                      value={feedbackDescription}
                      onChange={(e) => setFeedbackDescription(e.target.value)}
                      placeholder="Describe your idea or what happened in detail. If it's an AI error, include the text segment or rule that was incorrectly flagged/missed..."
                      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm outline-none transition focus:ring-2 focus:ring-[#0055FF]/30 focus:border-[#0055FF] ${
                        theme === 'dark'
                          ? 'bg-[#18181c] border-zinc-800 text-zinc-100 placeholder-zinc-500'
                          : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500 shadow-sm'
                      }`}
                    />
                  </div>

                  {/* Attach session context checkbox */}
                  <div className="flex items-center gap-2.5 pt-1">
                    <input
                      type="checkbox"
                      id="attachContextChk"
                      checked={attachFeedbackContext}
                      onChange={(e) => setAttachFeedbackContext(e.target.checked)}
                      className="w-4 h-4 rounded text-[#0055FF] focus:ring-[#0055FF] border-zinc-300 cursor-pointer"
                    />
                    <label htmlFor="attachContextChk" className="text-xs text-zinc-600 dark:text-zinc-400 font-medium cursor-pointer select-none">
                      Attach current article copy draft &amp; session metrics for context
                    </label>
                  </div>

                  {/* Submitter info note */}
                  <div className="text-[11px] text-zinc-400 font-mono pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between">
                    <span>Submitting as: <strong className="text-zinc-700 dark:text-zinc-300">{user?.email || 'editor@broadsheet.com.au'}</strong></span>
                    <span>Saved to Firestore DB</span>
                  </div>

                  {/* Submit Button */}
                  <div className="pt-2 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowFeedbackModal(false)}
                      className="px-4 py-2.5 border rounded-lg text-xs font-bold uppercase cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={feedbackSubmitting}
                      className="px-6 py-2.5 bg-[#0055FF] hover:bg-blue-600 active:translate-y-0.5 text-white rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer shadow-md transition disabled:opacity-50 flex items-center gap-2"
                    >
                      {feedbackSubmitting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Submit Feedback
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </form>
          </motion.div>
        </div>
      )}

      {/* Feedback Hub Modal */}
      {showFeedbackHub && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className={`max-w-5xl w-full h-[85vh] border rounded-2xl shadow-2xl flex flex-col overflow-hidden ${
              theme === 'dark' ? 'bg-[#121214] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            {/* Header */}
            <div className={`p-5 border-b flex items-center justify-between shrink-0 ${
              theme === 'dark' ? 'border-zinc-800 bg-[#18181b]' : 'border-zinc-150 bg-zinc-50'
            }`}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg tracking-tight m-0">Team Feedback Hub</h3>
                    <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-bold rounded-full uppercase">
                      {feedbackList.length} Submissions
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 font-mono m-0 mt-0.5">
                    User ideas, UX requests, and reported AI errors stored in Firestore
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={fetchFeedbackList}
                  className="p-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition cursor-pointer text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 flex items-center gap-1.5 text-xs font-bold uppercase"
                  title="Refresh feedback submissions"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${feedbackListLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  onClick={() => setShowFeedbackHub(false)}
                  className="p-1.5 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className={`px-5 py-3 border-b flex flex-wrap items-center justify-between gap-3 shrink-0 ${
              theme === 'dark' ? 'border-zinc-800 bg-[#18181c]/50' : 'border-zinc-100 bg-zinc-50/50'
            }`}>
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="text-[10px] uppercase font-bold text-zinc-400">Category:</span>
                {['all', 'idea', 'ux_request', 'ai_error', 'general'].map((cat) => (
                  <button
                    key={`fcat-${cat}`}
                    onClick={() => setFeedbackFilterCategory(cat)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase transition cursor-pointer ${
                      feedbackFilterCategory === cat
                        ? 'bg-[#0055FF] text-white shadow-sm'
                        : theme === 'dark'
                          ? 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                          : 'bg-zinc-200/60 text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {cat === 'all' ? 'All Categories' : cat.replace('_', ' ')}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold text-zinc-400">Status:</span>
                {['all', 'new', 'in_review', 'resolved', 'dismissed'].map((st) => (
                  <button
                    key={`fst-${st}`}
                    onClick={() => setFeedbackFilterStatus(st)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase transition cursor-pointer ${
                      feedbackFilterStatus === st
                        ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
                        : theme === 'dark'
                          ? 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                          : 'bg-zinc-200/60 text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {st === 'all' ? 'All Statuses' : st.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Main Content Split View */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {/* Left Pane: List */}
              <div className={`w-2/5 border-r overflow-y-auto p-3 space-y-2 shrink-0 ${
                theme === 'dark' ? 'border-zinc-800 bg-[#0e0e10]' : 'border-zinc-200 bg-zinc-50/30'
              }`}>
                {feedbackListLoading ? (
                  <div className="p-8 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-[#0055FF]" />
                    Loading feedback submissions...
                  </div>
                ) : feedbackList.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <MessageSquare className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto" />
                    <p className="text-xs text-zinc-500 font-medium m-0">No feedback submissions found.</p>
                  </div>
                ) : (
                  feedbackList
                    .filter(item => feedbackFilterCategory === 'all' || item.category === feedbackFilterCategory)
                    .filter(item => feedbackFilterStatus === 'all' || item.status === feedbackFilterStatus)
                    .map((item) => {
                      const isSelected = selectedFeedbackItem?.id === item.id;
                      const categoryColors = {
                        idea: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                        ux_request: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
                        ai_error: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
                        general: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                      };
                      const statusColors = {
                        new: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                        in_review: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
                        resolved: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                        dismissed: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                      };

                      return (
                        <div
                          key={item.id}
                          onClick={() => setSelectedFeedbackItem(item)}
                          className={`p-3.5 rounded-xl border transition cursor-pointer ${
                            isSelected
                              ? 'border-[#0055FF] bg-blue-50/30 dark:bg-blue-950/30 shadow-md'
                              : theme === 'dark'
                                ? 'border-zinc-800 bg-[#141416] hover:border-zinc-700'
                                : 'border-zinc-200 bg-white hover:border-zinc-300 shadow-sm'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${categoryColors[item.category as keyof typeof categoryColors] || categoryColors.general}`}>
                              {item.category.replace('_', ' ')}
                            </span>
                            <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${statusColors[item.status as keyof typeof statusColors] || statusColors.new}`}>
                              {item.status.replace('_', ' ')}
                            </span>
                          </div>

                          <h4 className="font-bold text-xs text-zinc-900 dark:text-zinc-100 line-clamp-2 m-0 leading-snug">
                            {item.title}
                          </h4>

                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-1 m-0">
                            {item.description}
                          </p>

                          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/60 text-[10px] font-mono text-zinc-400">
                            <span className="truncate">{item.userEmail}</span>
                            <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              {/* Right Pane: Selected Detail */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col justify-between">
                {selectedFeedbackItem ? (
                  <div className="space-y-6">
                    {/* Header info */}
                    <div className="space-y-3 border-b border-zinc-200/80 dark:border-zinc-800 pb-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs font-bold rounded-lg uppercase">
                            {selectedFeedbackItem.category.replace('_', ' ')}
                          </span>
                          <span className="px-2.5 py-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-bold rounded-lg uppercase">
                            Priority: {selectedFeedbackItem.priority}
                          </span>
                        </div>

                        {/* Status Change Buttons */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold uppercase text-zinc-400 mr-1">Set Status:</span>
                          {[
                            { id: 'new', label: 'New' },
                            { id: 'in_review', label: 'In Review' },
                            { id: 'resolved', label: 'Resolved' },
                            { id: 'dismissed', label: 'Dismiss' }
                          ].map((st) => (
                            <button
                              key={`stbtn-${st.id}`}
                              onClick={() => handleUpdateFeedbackStatus(selectedFeedbackItem.id, st.id)}
                              className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition cursor-pointer border ${
                                selectedFeedbackItem.status === st.id
                                  ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 border-zinc-950 dark:border-white'
                                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                              }`}
                            >
                              {st.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-50 m-0 leading-tight">
                        {selectedFeedbackItem.title}
                      </h2>

                      <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono">
                        <span>Submitter: <strong className="text-zinc-800 dark:text-zinc-200">{selectedFeedbackItem.userEmail}</strong></span>
                        <span>•</span>
                        <span>Submitted: {new Date(selectedFeedbackItem.timestamp).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Detailed Description */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 m-0">Detailed Description</h4>
                      <div className={`p-4 rounded-xl border text-sm leading-relaxed whitespace-pre-wrap ${
                        theme === 'dark' ? 'bg-[#18181c] border-zinc-800 text-zinc-200' : 'bg-zinc-50 border-zinc-200 text-zinc-800'
                      }`}>
                        {selectedFeedbackItem.description}
                      </div>
                    </div>

                    {/* Attached Context */}
                    {selectedFeedbackItem.attachedContext && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 m-0">Attached Session Context</h4>
                        <div className={`p-3.5 rounded-xl border font-mono text-xs leading-relaxed whitespace-pre-wrap ${
                          theme === 'dark' ? 'bg-[#0f0f12] border-zinc-800 text-zinc-400' : 'bg-zinc-100 border-zinc-200 text-zinc-600'
                        }`}>
                          {selectedFeedbackItem.attachedContext}
                        </div>
                      </div>
                    )}

                    {/* Admin Delete Action */}
                    {userRole === 'admin' && (
                      <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
                        <button
                          onClick={() => handleDeleteFeedback(selectedFeedbackItem.id)}
                          className="px-3 py-1.5 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg text-xs font-bold uppercase cursor-pointer flex items-center gap-1.5 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete Feedback Entry
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                    <MessageSquare className="w-12 h-12 text-zinc-300 dark:text-zinc-700" />
                    <p className="text-sm font-medium text-zinc-500 m-0">Select a feedback item from the list on the left to view details.</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Data Privacy & AI Safeguards Modal */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`w-full max-w-3xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
              theme === 'dark' ? 'bg-[#121215] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            {/* Header */}
            <div className={`p-6 border-b flex items-center justify-between ${
              theme === 'dark' ? 'border-zinc-800 bg-[#18181c]' : 'border-zinc-200 bg-zinc-50'
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold uppercase tracking-tight m-0 flex items-center gap-2">
                    Broadsheet Data Protection &amp; AI Privacy Safeguards
                  </h2>
                  <p className="text-xs text-zinc-500 m-0 mt-0.5">
                    Third-Party Model Training Opt-Out &amp; Data Leakage Prevention Architecture
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowPrivacyModal(false)}
                className="p-2 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Organization Shield Summary Box */}
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-start gap-3">
                <Lock className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs leading-relaxed">
                  <span className="font-bold uppercase tracking-wider block">Enterprise Privacy Guarantee for Broadsheet Media</span>
                  <p className="m-0">
                    All copy, draft articles, house style guides, and audit logs processed by this application are protected under strict zero-retention mandates. 
                    Broadsheet's data is isolated from third-party foundation model training pipelines and never cached in secondary storage.
                  </p>
                </div>
              </div>

              {/* Safeguards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {privacyStatus?.safeguards ? (
                  Object.entries(privacyStatus.safeguards).map(([key, item]: [string, any]) => (
                    <div
                      key={key}
                      className={`p-4 rounded-xl border space-y-2 ${
                        theme === 'dark' ? 'bg-[#18181c] border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          {item.status}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 m-0 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  ))
                ) : (
                  [
                    {
                      title: "Third-Party AI Model Training Opt-Out",
                      status: "ENFORCED",
                      desc: "System instructions and API headers explicitly mandate zero third-party AI model training and zero dataset ingestion."
                    },
                    {
                      title: "Zero Data Retention Policy",
                      status: "ENFORCED",
                      desc: "Prompts and editorial copy are processed ephemerally in server memory with no persistent external retention."
                    },
                    {
                      title: "Server-Side Proxy Isolation",
                      status: "ENFORCED",
                      desc: "All Gemini API calls are proxied strictly via server-side routes (/api/*). No API keys or tokens are exposed to client devices."
                    },
                    {
                      title: "PII & Secret Redaction Engine",
                      status: "ACTIVE",
                      desc: "Automatic sanitization and scrubbing of sensitive credentials, API tokens, and personal identifiers before AI execution."
                    },
                    {
                      title: "Data Cache Prevention Headers",
                      status: "ENFORCED",
                      desc: "HTTP responses carry strict Cache-Control: no-store and no-cache headers to prevent browser/CDN caching of sensitive copy."
                    },
                    {
                      title: "Firestore Zero-Trust Access Rules",
                      status: "ENFORCED",
                      desc: "Firestore zero-trust Security Rules prevent direct client writes and validate all document schemas."
                    }
                  ].map((sg, idx) => (
                    <div
                      key={`sg-${idx}`}
                      className={`p-4 rounded-xl border space-y-2 ${
                        theme === 'dark' ? 'bg-[#18181c] border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200">
                          {sg.title}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          {sg.status}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 m-0 leading-relaxed">
                        {sg.desc}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {/* Technical Safeguard Details */}
              <div className={`p-4 rounded-xl border space-y-3 ${
                theme === 'dark' ? 'bg-[#0f0f12] border-zinc-800' : 'bg-zinc-100/70 border-zinc-200'
              }`}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 m-0 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-emerald-500" />
                  Technical Invariants &amp; Compliance Details
                </h4>
                <ul className="text-xs text-zinc-600 dark:text-zinc-300 space-y-1.5 m-0 pl-4 list-disc leading-relaxed">
                  <li><strong>Prompt-Level Directives:</strong> Every model request includes non-negotiable enterprise instructions prohibiting data retention or dataset compilation.</li>
                  <li><strong>API Headers:</strong> Outgoing HTTP headers specify <code className="font-mono text-[11px] bg-zinc-200 dark:bg-zinc-800 px-1 rounded">X-Data-Privacy-Policy: Enterprise-Zero-Training</code> and <code className="font-mono text-[11px] bg-zinc-200 dark:bg-zinc-800 px-1 rounded">X-No-Data-Retention: true</code>.</li>
                  <li><strong>Sanitization Engine:</strong> <code className="font-mono text-[11px] bg-zinc-200 dark:bg-zinc-800 px-1 rounded">redactSensitiveData()</code> scrubs API keys, bearer tokens, passwords, and PII before AI model invocation.</li>
                  <li><strong>Browser Isolation:</strong> Zero client-side API key instantiation. All LLM calls pass through Express backend endpoints.</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className={`p-4 border-t flex items-center justify-between ${
              theme === 'dark' ? 'border-zinc-800 bg-[#18181c]' : 'border-zinc-200 bg-zinc-50'
            }`}>
              <div className="text-[11px] font-mono text-zinc-500">
                Broadsheet Security Spec v2.4 • Active Protection
              </div>
              <button
                onClick={() => setShowPrivacyModal(false)}
                className="px-4 py-2 bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 font-bold text-xs uppercase rounded-lg hover:opacity-90 transition cursor-pointer"
              >
                Close Safeguards Panel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Admin Usage Stats Modal */}
      {showUsageStatsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`w-full max-w-5xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] ${
              theme === 'dark' ? 'bg-[#121215] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            {/* Modal Header */}
            <div className={`p-6 border-b flex items-center justify-between ${
              theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-zinc-100/90'
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <BarChart3 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className={`text-lg font-black uppercase tracking-tight m-0 flex items-center gap-2 ${
                    theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                  }`}>
                    Usage &amp; Activity Statistics
                  </h2>
                  <p className={`text-xs font-semibold m-0 mt-0.5 ${
                    theme === 'dark' ? 'text-zinc-400' : 'text-zinc-700'
                  }`}>
                    Broadsheet Editorial Style Checker • System Utilization &amp; AI Accuracy Analytics
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchUsageStats}
                  disabled={usageStatsLoading}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase transition flex items-center gap-1.5 cursor-pointer shadow-sm ${
                    theme === 'dark'
                      ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                      : 'bg-zinc-900 text-white hover:bg-zinc-800'
                  }`}
                  title="Refresh Statistics"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${usageStatsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  onClick={() => setShowUsageStatsModal(false)}
                  className={`p-2 rounded-lg transition cursor-pointer ${
                    theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-300' : 'hover:bg-zinc-200 text-zinc-700'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {usageStatsLoading && !usageStatsData ? (
                <div className="py-20 text-center space-y-3">
                  <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
                  <p className={`text-xs font-bold uppercase tracking-wider ${
                    theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'
                  }`}>Aggregating System Metrics...</p>
                </div>
              ) : usageStatsError ? (
                <div className={`p-4 rounded-xl text-xs space-y-2 border ${
                  theme === 'dark' ? 'bg-red-950/40 border-red-800 text-red-200' : 'bg-red-50 border-red-300 text-red-900'
                }`}>
                  <span className="font-bold uppercase block text-red-600">Error Loading Stats</span>
                  <p className="m-0">{usageStatsError}</p>
                </div>
              ) : usageStatsData ? (
                <>
                  {/* Top Key Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                    {/* Total Reviews (All Time) */}
                    <div className={`p-4 rounded-xl border shadow-sm space-y-1 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider block ${
                        theme === 'dark' ? 'text-zinc-300' : 'text-zinc-800'
                      }`}>Total Reviews</span>
                      <div className={`text-2xl font-black ${
                        theme === 'dark' ? 'text-indigo-400' : 'text-indigo-700'
                      }`}>
                        {usageStatsData.summary.totalSessionReviews.toLocaleString()}
                      </div>
                      <span className={`text-[10px] block font-semibold ${
                        theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'
                      }`}>All-time style runs</span>
                    </div>

                    {/* Reviews Last 30 Days */}
                    <div className={`p-4 rounded-xl border shadow-sm space-y-1 ${
                      theme === 'dark' ? 'bg-indigo-950/30 border-indigo-900/60' : 'bg-indigo-50/70 border-indigo-200'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-extrabold uppercase tracking-wider block ${
                          theme === 'dark' ? 'text-indigo-300' : 'text-indigo-900'
                        }`}>Reviews (30d)</span>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase ${
                          theme === 'dark' ? 'bg-indigo-900 text-indigo-200' : 'bg-indigo-200 text-indigo-900'
                        }`}>30 Days</span>
                      </div>
                      <div className={`text-2xl font-black ${
                        theme === 'dark' ? 'text-indigo-300' : 'text-indigo-800'
                      }`}>
                        {(usageStatsData.summary.totalReviews30Days ?? usageStatsData.summary.totalSessionReviews).toLocaleString()}
                      </div>
                      <span className={`text-[10px] block font-semibold ${
                        theme === 'dark' ? 'text-indigo-400' : 'text-indigo-700'
                      }`}>In last 30 days</span>
                    </div>

                    {/* Words Processed */}
                    <div className={`p-4 rounded-xl border shadow-sm space-y-1 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider block ${
                        theme === 'dark' ? 'text-zinc-300' : 'text-zinc-800'
                      }`}>Words Processed</span>
                      <div className={`text-2xl font-black ${
                        theme === 'dark' ? 'text-blue-400' : 'text-blue-700'
                      }`}>
                        {usageStatsData.summary.totalWordsReviewed.toLocaleString()}
                      </div>
                      <span className={`text-[10px] block font-semibold ${
                        theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'
                      }`}>Draft word count</span>
                    </div>

                    {/* Human Audits */}
                    <div className={`p-4 rounded-xl border shadow-sm space-y-1 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider block ${
                        theme === 'dark' ? 'text-zinc-300' : 'text-zinc-800'
                      }`}>Human Audits</span>
                      <div className={`text-2xl font-black ${
                        theme === 'dark' ? 'text-purple-400' : 'text-purple-700'
                      }`}>
                        {usageStatsData.summary.totalCrossChecks.toLocaleString()}
                      </div>
                      <span className={`text-[10px] block font-semibold ${
                        theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'
                      }`}>Cross-checks run</span>
                    </div>

                    {/* AI Accuracy */}
                    <div className={`p-4 rounded-xl border shadow-sm space-y-1 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider block ${
                        theme === 'dark' ? 'text-zinc-300' : 'text-zinc-800'
                      }`}>AI Accuracy</span>
                      <div className={`text-2xl font-black ${
                        theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'
                      }`}>
                        {usageStatsData.summary.averageAccuracyScore}%
                      </div>
                      <span className={`text-[10px] block font-semibold ${
                        theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'
                      }`}>Sub-editor score</span>
                    </div>

                    {/* Acceptance Rate */}
                    <div className={`p-4 rounded-xl border shadow-sm space-y-1 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider block ${
                        theme === 'dark' ? 'text-zinc-300' : 'text-zinc-800'
                      }`}>Acceptance Rate</span>
                      <div className={`text-2xl font-black ${
                        theme === 'dark' ? 'text-amber-400' : 'text-amber-700'
                      }`}>
                        {usageStatsData.summary.overallAcceptanceRate}%
                      </div>
                      <span className={`text-[10px] block font-semibold ${
                        theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'
                      }`}>{usageStatsData.summary.totalAccepted} applied</span>
                    </div>

                    {/* System Users (Total) */}
                    <div className={`p-4 rounded-xl border shadow-sm space-y-1 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider block ${
                        theme === 'dark' ? 'text-zinc-300' : 'text-zinc-800'
                      }`}>Total Users</span>
                      <div className={`text-2xl font-black ${
                        theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                      }`}>
                        {usageStatsData.summary.totalUsers}
                      </div>
                      <span className={`text-[10px] block font-semibold ${
                        theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'
                      }`}>{usageStatsData.usersByRole.admin || 0} admins, {usageStatsData.usersByRole.editor || 0} editors</span>
                    </div>

                    {/* System Users Last 30 Days */}
                    <div className={`p-4 rounded-xl border shadow-sm space-y-1 ${
                      theme === 'dark' ? 'bg-emerald-950/30 border-emerald-900/60' : 'bg-emerald-50/70 border-emerald-200'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-extrabold uppercase tracking-wider block ${
                          theme === 'dark' ? 'text-emerald-300' : 'text-emerald-900'
                        }`}>Users (30d)</span>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase ${
                          theme === 'dark' ? 'bg-emerald-900 text-emerald-200' : 'bg-emerald-200 text-emerald-900'
                        }`}>30 Days</span>
                      </div>
                      <div className={`text-2xl font-black ${
                        theme === 'dark' ? 'text-emerald-300' : 'text-emerald-800'
                      }`}>
                        {usageStatsData.summary.users30Days ?? usageStatsData.summary.totalUsers}
                      </div>
                      <span className={`text-[10px] block font-semibold ${
                        theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'
                      }`}>Active in last 30d</span>
                    </div>
                  </div>

                  {/* Two Column Layout for Breakdown Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Top Flagged Rules */}
                    <div className={`p-5 rounded-xl border shadow-sm space-y-4 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                    }`}>
                      <div className={`flex items-center justify-between border-b pb-3 ${
                        theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
                      }`}>
                        <h3 className={`text-xs font-black uppercase tracking-wider m-0 flex items-center gap-2 ${
                          theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                        }`}>
                          <Activity className={`w-4 h-4 ${
                            theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'
                          }`} />
                          Most Frequently Flagged Style Rules
                        </h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                          theme === 'dark' ? 'text-zinc-300 bg-zinc-800 border-zinc-700' : 'text-zinc-800 bg-zinc-100 border-zinc-300'
                        }`}>Style Checker</span>
                      </div>
                      {usageStatsData.topFlaggedRules && usageStatsData.topFlaggedRules.length > 0 ? (
                        <div className="space-y-3">
                          {usageStatsData.topFlaggedRules.map((item: any, idx: number) => {
                            const maxCount = usageStatsData.topFlaggedRules[0].count;
                            const pct = Math.round((item.count / maxCount) * 100);
                            return (
                              <div key={`frule-${idx}`} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className={`font-black truncate max-w-[290px] ${
                                    theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                                  }`}>
                                    {idx + 1}. {item.rule}
                                  </span>
                                  <span className={`font-black px-2 py-0.5 border rounded ${
                                    theme === 'dark'
                                      ? 'text-indigo-300 bg-indigo-950/80 border-indigo-800'
                                      : 'text-indigo-900 bg-indigo-100 border-indigo-300'
                                  }`}>
                                    {item.count} flags
                                  </span>
                                </div>
                                <div className={`w-full h-2 rounded-full overflow-hidden ${
                                  theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'
                                }`}>
                                  <div className={`h-full rounded-full ${
                                    theme === 'dark' ? 'bg-indigo-500' : 'bg-indigo-600'
                                  }`} style={{ width: `${pct}%` }}></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className={`text-xs italic ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>No style flags logged yet.</p>
                      )}
                    </div>

                    {/* Top Missed Rules in Crosschecks */}
                    <div className={`p-5 rounded-xl border shadow-sm space-y-4 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                    }`}>
                      <div className={`flex items-center justify-between border-b pb-3 ${
                        theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
                      }`}>
                        <h3 className={`text-xs font-black uppercase tracking-wider m-0 flex items-center gap-2 ${
                          theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                        }`}>
                          <FileCheck className={`w-4 h-4 ${
                            theme === 'dark' ? 'text-purple-400' : 'text-purple-600'
                          }`} />
                          Top AI Alignment Gaps (Sub-Editor Audits)
                        </h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                          theme === 'dark' ? 'text-zinc-300 bg-zinc-800 border-zinc-700' : 'text-zinc-800 bg-zinc-100 border-zinc-300'
                        }`}>Cross-Checks</span>
                      </div>
                      {usageStatsData.topMissedRules && usageStatsData.topMissedRules.length > 0 ? (
                        <div className="space-y-3">
                          {usageStatsData.topMissedRules.map((item: any, idx: number) => {
                            const maxCount = usageStatsData.topMissedRules[0].count;
                            const pct = Math.round((item.count / maxCount) * 100);
                            return (
                              <div key={`mrule-${idx}`} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className={`font-black truncate max-w-[290px] ${
                                    theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                                  }`}>
                                    {idx + 1}. {item.rule}
                                  </span>
                                  <span className={`font-black px-2 py-0.5 border rounded ${
                                    theme === 'dark'
                                      ? 'text-purple-300 bg-purple-950/80 border-purple-800'
                                      : 'text-purple-900 bg-purple-100 border-purple-300'
                                  }`}>
                                    {item.count} missed
                                  </span>
                                </div>
                                <div className={`w-full h-2 rounded-full overflow-hidden ${
                                  theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'
                                }`}>
                                  <div className={`h-full rounded-full ${
                                    theme === 'dark' ? 'bg-purple-500' : 'bg-purple-600'
                                  }`} style={{ width: `${pct}%` }}></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className={`text-xs italic ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>No human sub-editor alignment gaps logged yet.</p>
                      )}
                    </div>
                  </div>

                  {/* Feedback & Team System Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Feedback Breakdown */}
                    <div className={`p-5 rounded-xl border shadow-sm space-y-4 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                    }`}>
                      <div className={`flex items-center justify-between border-b pb-3 ${
                        theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
                      }`}>
                        <h3 className={`text-xs font-black uppercase tracking-wider m-0 flex items-center gap-2 ${
                          theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                        }`}>
                          <MessageSquare className={`w-4 h-4 ${
                            theme === 'dark' ? 'text-amber-400' : 'text-amber-600'
                          }`} />
                          User Feedback &amp; Issues Submissions
                        </h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                          theme === 'dark' ? 'text-amber-200 bg-amber-950/80 border-amber-800' : 'text-amber-900 bg-amber-100 border-amber-300'
                        }`}>Total: {usageStatsData.summary.totalFeedback}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className={`p-3 rounded-lg space-y-1.5 border ${
                          theme === 'dark' ? 'bg-zinc-800/80 border-zinc-700' : 'bg-zinc-100 border-zinc-200'
                        }`}>
                          <span className={`text-[10px] font-extrabold uppercase block ${
                            theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'
                          }`}>By Category</span>
                          <div className="space-y-1 font-bold text-[11px]">
                            <div className={`flex justify-between ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>
                              <span>Ideas:</span> <strong className={theme === 'dark' ? 'text-blue-400' : 'text-blue-700'}>{usageStatsData.feedbackByCategory?.idea || 0}</strong>
                            </div>
                            <div className={`flex justify-between ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>
                              <span>UX Requests:</span> <strong className={theme === 'dark' ? 'text-purple-400' : 'text-purple-700'}>{usageStatsData.feedbackByCategory?.ux_request || 0}</strong>
                            </div>
                            <div className={`flex justify-between ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>
                              <span>AI Errors:</span> <strong className={theme === 'dark' ? 'text-red-400' : 'text-red-700'}>{usageStatsData.feedbackByCategory?.ai_error || 0}</strong>
                            </div>
                            <div className={`flex justify-between ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>
                              <span>General:</span> <strong className={theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}>{usageStatsData.feedbackByCategory?.general || 0}</strong>
                            </div>
                          </div>
                        </div>

                        <div className={`p-3 rounded-lg space-y-1.5 border ${
                          theme === 'dark' ? 'bg-zinc-800/80 border-zinc-700' : 'bg-zinc-100 border-zinc-200'
                        }`}>
                          <span className={`text-[10px] font-extrabold uppercase block ${
                            theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'
                          }`}>By Resolution Status</span>
                          <div className="space-y-1 font-bold text-[11px]">
                            <div className={`flex justify-between ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>
                              <span>New:</span> <strong className={theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'}>{usageStatsData.feedbackByStatus?.new || 0}</strong>
                            </div>
                            <div className={`flex justify-between ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>
                              <span>In Review:</span> <strong className={theme === 'dark' ? 'text-amber-400' : 'text-amber-700'}>{usageStatsData.feedbackByStatus?.in_review || 0}</strong>
                            </div>
                            <div className={`flex justify-between ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>
                              <span>Resolved:</span> <strong className={theme === 'dark' ? 'text-blue-400' : 'text-blue-700'}>{usageStatsData.feedbackByStatus?.resolved || 0}</strong>
                            </div>
                            <div className={`flex justify-between ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}`}>
                              <span>Dismissed:</span> <strong className={theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}>{usageStatsData.feedbackByStatus?.dismissed || 0}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Team Authorized Users Table */}
                    <div className={`p-5 rounded-xl border shadow-sm space-y-4 ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
                    }`}>
                      <div className={`flex items-center justify-between border-b pb-3 ${
                        theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
                      }`}>
                        <h3 className={`text-xs font-black uppercase tracking-wider m-0 flex items-center gap-2 ${
                          theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                        }`}>
                          <Users className={`w-4 h-4 ${
                            theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
                          }`} />
                          Authorized Team Roster ({usageStatsData.usersList?.length || 0})
                        </h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                          theme === 'dark' ? 'text-zinc-300 bg-zinc-800 border-zinc-700' : 'text-zinc-800 bg-zinc-100 border-zinc-300'
                        }`}>Roles</span>
                      </div>
                      <div className="max-h-[160px] overflow-y-auto space-y-2 pr-1">
                        {usageStatsData.usersList && usageStatsData.usersList.length > 0 ? (
                          usageStatsData.usersList.map((u: any, idx: number) => (
                            <div key={`uusr-${idx}`} className={`flex items-center justify-between p-2.5 rounded text-xs border ${
                              theme === 'dark' ? 'bg-zinc-800/80 border-zinc-700' : 'bg-zinc-100/80 border-zinc-200'
                            }`}>
                              <span className={`truncate max-w-[200px] font-bold ${
                                theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'
                              }`}>{u.email}</span>
                              <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide ${
                                  u.role === 'admin' ? (theme === 'dark' ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-purple-100 text-purple-900 border border-purple-300') :
                                  u.role === 'sub-editor' ? (theme === 'dark' ? 'bg-blue-950 text-blue-300 border border-blue-800' : 'bg-blue-100 text-blue-900 border border-blue-300') :
                                  (theme === 'dark' ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'bg-zinc-200 text-zinc-900 border border-zinc-300')
                                }`}>
                                  {u.role}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className={`text-xs italic ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>No user directory records found.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className={`p-4 border-t flex items-center justify-between ${
              theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-zinc-100/90'
            }`}>
              <div className={`text-[11px] font-bold ${
                theme === 'dark' ? 'text-zinc-300' : 'text-zinc-800'
              }`}>
                Broadsheet Usage &amp; Analytics Engine • Admin Protected
              </div>
              <button
                onClick={() => setShowUsageStatsModal(false)}
                className={`px-4 py-2 font-bold text-xs uppercase rounded-lg transition cursor-pointer shadow-sm ${
                  theme === 'dark' ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-zinc-950 text-white hover:bg-zinc-800'
                }`}
              >
                Close Stats Panel
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
