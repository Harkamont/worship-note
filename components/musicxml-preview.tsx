'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createMusicXMLChordPreview } from '@/lib/musicxml-chord-preview';
import { assertMusicXMLPreviewSafe } from '@/lib/musicxml-preview';

export default function MusicXMLPreview({ xml }: { xml: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<{ xml: string; status: 'ready' | 'error'; message?: string } | null>(null);
  const state = rendered?.xml === xml ? rendered.status : 'loading';
  useEffect(() => {
    let active = true;
    let clear: (() => void) | undefined;
    const target = ref.current;
    target?.replaceChildren();
    const render = async () => {
      try {
        assertMusicXMLPreviewSafe(xml);
        const doc = new DOMParser().parseFromString(createMusicXMLChordPreview(xml).replace(/^\uFEFF/, ''), 'application/xml');
        if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'score-partwise' || /<!ENTITY/i.test(xml)) throw new Error('Unsupported XML');
        // The client analyzer already rejects internal DTD/entity declarations.
        // Remove an inert external declaration before handing the Document on.
        if (doc.doctype) doc.removeChild(doc.doctype);
        const instructions = doc.createTreeWalker(doc, NodeFilter.SHOW_PROCESSING_INSTRUCTION);
        const remove: Node[] = [];
        while (instructions.nextNode()) remove.push(instructions.currentNode);
        remove.forEach(node => node.parentNode?.removeChild(node));
        // Pass a Document, never a URL. Reject external resources and executable
        // content before the renderer sees the source; the download stays intact.
        for (const node of Array.from(doc.querySelectorAll('*'))) {
          if (['script', 'foreignobject', 'iframe', 'object', 'embed', 'img', 'image', 'credit-image', 'link'].includes(node.localName.toLowerCase())) throw new Error('Unsafe resource');
          for (const attribute of Array.from(node.attributes)) {
            if (/^on/i.test(attribute.localName) || ['href', 'src'].includes(attribute.localName.toLowerCase()) || /url\s*\(/i.test(attribute.value)) throw new Error('Unsafe attribute');
          }
        }
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (!active || !target) return;
        const detached = document.createElement('div');
        detached.style.width = '1000px';
        // OSMD lays out from offsetWidth. Keep rendering detached while giving
        // it the same fixed width as the horizontally scrollable preview.
        Object.defineProperty(detached, 'offsetWidth', { value: 1000 });
        const display = new OpenSheetMusicDisplay(detached, { autoResize: false, backend: 'svg', drawTitle: true, drawCredits: true });
        clear = () => display.clear();
        await display.load(doc);
        if (!active) return;
        display.render();
        // Only renderer-created graphics enter the visible page. A second check
        // also removes links or executable nodes should a future renderer add any.
        for (const node of Array.from(detached.querySelectorAll('script,style,foreignObject,iframe,object,embed,image,a'))) node.remove();
        for (const node of Array.from(detached.querySelectorAll('*'))) for (const attribute of Array.from(node.attributes)) {
          const name = attribute.localName.toLowerCase();
          if (/^on/i.test(name) || name === 'src' || (name === 'href' && !/^#[\w:.-]+$/.test(attribute.value)) || /url\s*\(\s*["']?(?!#)/i.test(attribute.value)) node.removeAttributeNode(attribute);
        }
        for (const svg of Array.from(detached.querySelectorAll('svg'))) {
          const width = Number.parseFloat(svg.getAttribute('width') ?? '');
          const height = Number.parseFloat(svg.getAttribute('height') ?? '');
          if (!svg.hasAttribute('viewBox') && width > 0 && height > 0) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        }
        const pages = Array.from(detached.querySelectorAll('svg'));
        if (!pages.length) throw new Error('No rendered pages');
        target.replaceChildren(...pages);
        setRendered({ xml, status: 'ready' });
      } catch (cause) { if (active) setRendered({ xml, status: 'error', ...(cause instanceof Error && cause.name === 'MusicXMLPreviewLimitError' ? { message: cause.message } : {}) }); }
    };
    void render();
    return () => { active = false; clear?.(); target?.replaceChildren(); };
  }, [xml]);
  return <div className="direct-musicxml-render">
    {state === 'loading' && <p className="direct-musicxml-status" role="status"><Loader2 size={17} className="spin"/>악보를 그리고 있어요…</p>}
    {state === 'error' && <p className="local-text-error" role="alert">{rendered?.message || '이 XML을 화면에 그리지 못했습니다. 원본 XML 다운로드와 검토 내용은 계속 사용할 수 있어요.'}</p>}
    <div ref={ref} className="direct-musicxml-sheet" aria-label="원본 MusicXML 렌더링 악보" hidden={state !== 'ready'}/>
  </div>;
}

