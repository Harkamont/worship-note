'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { HelpTip } from '@/components/help-tip';

type Provider = 'openrouter' | 'openai' | 'zai';
type Settings = { desktop: true; provider: Provider; model: string; baseURL: string; configured: boolean; keyConfigured: boolean };
const defaults: Record<Provider, string> = { openrouter: 'openai/gpt-6.1-sol', openai: 'gpt-6.1-sol', zai: 'glm-4.6v-flash' };
function readSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('설정 정보를 읽지 못했습니다.');
  const data = value as Record<string, unknown>;
  if (data.desktop !== true || !['openrouter', 'openai', 'zai'].includes(String(data.provider)) || typeof data.model !== 'string' || data.model.length > 200 || typeof data.baseURL !== 'string' || typeof data.configured !== 'boolean' || typeof data.keyConfigured !== 'boolean') throw new Error('설정 정보를 읽지 못했습니다.');
  return data as Settings;
}

export default function AIConnection({ onChanged }: { onChanged: () => void }) {
  const [stored, setStored] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<Provider>('openrouter');
  const [model, setModel] = useState(defaults.openrouter);
  const [apiKey, setAPIKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/local-settings', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 404) return;
      if (!response.ok) throw new Error('AI 설정을 불러오지 못했습니다. 앱을 다시 실행한 뒤 확인해 주세요.');
      const value = readSettings(await response.json());
      if (!controller.signal.aborted) { setStored(value); setProvider(value.provider); setModel(value.model || defaults[value.provider]); setAvailable(true); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '설정을 읽지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, []);
  async function save(clearKey = false) {
    if (saving || !available) return;
    if (!clearKey && !model.trim()) { setError('사용할 모델 이름을 입력해 주세요.'); return; }
    if (!clearKey && stored?.keyConfigured && provider !== stored.provider && !apiKey.trim()) { setError('서비스를 바꾸려면 새 서비스의 API 키를 입력해 주세요.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/local-settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(clearKey ? { provider: stored?.provider ?? provider, model: stored?.model ?? model.trim(), clearKey: true } : { provider, model: model.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }) });
      if (!response.ok) throw new Error('설정을 저장하지 못했습니다. 서비스·모델·키를 확인해 주세요.');
      const value = readSettings(await response.json());
      setStored(value); setProvider(value.provider); setModel(value.model); setAPIKey('');
      setNotice(clearKey ? '저장한 API 키를 삭제했습니다. 무료 음표 읽기와 편집은 계속 사용할 수 있습니다.' : '연결 정보를 저장했습니다. AI 요청은 아직 보내지 않았습니다.');
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  }
  return <section className="ai-connection" aria-label="유료 AI 연결 설정">
    <div className="help-heading"><h3>AI 연결 <span className="paid-label">선택 · 유료</span></h3><HelpTip helpKey="aiConnection"/></div>
    <details className="ai-connection-details"><summary>AI 서비스 설정</summary>
    {loading ? <p role="status"><Loader2 size={15} className="spin"/>연결 정보를 확인하고 있어요…</p> : available ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="ai-key-status">{stored?.keyConfigured ? '연결 키 저장됨 · 실제 연결은 AI 요청을 보낼 때 확인합니다.' : '연결 키가 없습니다.'}</p>
      <label className="modal-field">AI 서비스<select aria-label="AI 서비스" disabled={saving} value={provider} onChange={event => { const next = event.target.value as Provider; setProvider(next); setModel(defaults[next]); setAPIKey(''); setNotice(''); setError(''); }}><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option><option value="zai">Z.ai</option></select></label>
      <label className="modal-field">AI 모델 이름<input aria-label="AI 모델 이름" disabled={saving} value={model} maxLength={200} autoComplete="off" spellCheck={false} onChange={event => setModel(event.target.value)}/></label>
      <label className="modal-field">서비스 연결 키 (API 키)<input aria-label="AI API 키" type="password" disabled={saving} value={apiKey} maxLength={8192} autoComplete="new-password" spellCheck={false} placeholder={stored?.keyConfigured && provider === stored.provider ? '비워두면 저장된 키를 유지합니다' : '선택한 서비스에서 발급한 키'} onChange={event => setAPIKey(event.target.value)}/></label>
      <div className="ai-connection-actions"><button className="button primary" type="submit" disabled={saving}>{saving ? <Loader2 size={15} className="spin"/> : <Save size={15}/>}연결 정보 저장</button><button className="button outline" type="button" disabled={saving || !stored?.keyConfigured} onClick={() => void save(true)}><Trash2 size={15}/>저장한 키 삭제</button></div>
    </form> : <p className="input-hint">설치형 앱에서 AI 서비스를 직접 연결할 수 있습니다.</p>}
    </details>
    {error && <p className="local-text-error" role="alert">{error}</p>}
    {notice && <p className="direct-musicxml-status" role="status">{notice}</p>}
  </section>;
}
