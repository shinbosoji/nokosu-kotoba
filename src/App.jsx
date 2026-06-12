import React, { useState, useRef, useEffect } from 'react';

const ACCENT = '#C97B5C';
const INK = '#2B3A4A';
const PAPER = '#FAF6EF';
const SAGE = '#7E9B7E';
const LINE = '#E2D9C9';

const SYSTEM_PROMPT = `あなたは「のこす言葉」というサービスの聞き手AIです。
利用者(主に60代以上の方)と、雑談のような対話を行いながら、その人の人生・資産・契約・家族への想いを丁寧に聞き取り、記録していく役割です。

【話し方】
- 質問は一度に1つだけ。やさしく、ゆっくりとした口調で。
- 「最近どうですか」「あの件、考えてみましたか」のような、世間話の延長として自然に話を引き出してください。
- 専門用語や事務的な言い方は避けてください。
- 相手の話に共感を示しながら、次の話題に自然につなげてください。
- 長い説明はせず、会話のキャッチボールを大切にしてください。
- これまでに記録された内容(下記の既存ドラフト)と矛盾しないよう、また同じ話を繰り返し聞かないよう配慮してください。話題が一通り出てきたら、別の話題(資産、持ち物、家族へのメッセージ、思い出など)にやさしく移ってください。

【記録の抽出】
会話の中から、以下の2つの文書を更新するための情報を抽出してください。新しい情報のみを抽出し、既に記録済みの内容は繰り返さないでください。

1. 本人専用ドラフト(personalDraft) - 本人だけが見る詳細な記録
   - 資産(不動産、預金、証券、保険など)の詳細
   - 大切な持ち物や思い出の品について
   - パスワードや重要書類の「在りか」のヒント(パスワード自体は記録しない。「仏壇の引き出しにメモがある」など、保管場所や手がかりのみ)
   - 本人の本音、迷い、希望

2. 家族向け要約(familySummary) - 家族に伝えたいことをまとめた、平易でやさしい文章
   - 家族への感謝やメッセージ
   - 「これだけは伝えておきたい」という意思表示
   - 専門用語を避けた、温かい言葉でまとめる

【出力形式】
必ず以下のJSON形式で出力してください。他の文章は一切含めないでください。

{
  "reply": "(利用者への返答。やさしい会話文)",
  "personalDraftUpdates": [
    {"category": "資産" | "持ち物" | "重要書類の在りか" | "本音・希望", "content": "(抽出した内容)"}
  ],
  "familySummaryUpdates": [
    {"category": "家族へのメッセージ" | "伝えたい意思" | "感謝の言葉", "content": "(抽出した内容)"}
  ]
}

新しく記録すべき情報がなければ、personalDraftUpdates や familySummaryUpdates は空配列にしてください。`;

const CATEGORY_ORDER_PERSONAL = ['資産', '持ち物', '重要書類の在りか', '本音・希望'];
const CATEGORY_ORDER_FAMILY = ['家族へのメッセージ', '伝えたい意思', '感謝の言葉'];
const STORAGE_KEY = 'nokosu-kotoba-data-v1';

function callClaude(messages, system) {
  // This calls our own serverless proxy (api/chat) which holds the
  // ANTHROPIC_API_KEY server-side. Never call api.anthropic.com directly
  // from the client outside Claude.ai's sandboxed artifact environment.
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system }),
  }).then((r) => r.json());
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

function buildSystemPrompt(personalEntries, familyEntries) {
  let context = SYSTEM_PROMPT;
  if (personalEntries.length > 0 || familyEntries.length > 0) {
    context += '\n\n【これまでに記録済みの内容(参考。同じ話を繰り返し聞かないこと)】\n';
    if (personalEntries.length > 0) {
      context += '本人専用ドラフト:\n';
      personalEntries.forEach((e) => {
        context += `- [${e.category}] ${e.content}\n`;
      });
    }
    if (familyEntries.length > 0) {
      context += '家族向け要約:\n';
      familyEntries.forEach((e) => {
        context += `- [${e.category}] ${e.content}\n`;
      });
    }
  }
  return context;
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function buildMarkdown(title, entries, order, profile) {
  let md = `# ${title}\n\n`;
  md += `作成日: ${formatDate(Date.now())}\n`;
  if (profile && profile.name) {
    md += `お名前: ${profile.name}\n`;
  }
  md += '\n';
  if (entries.length === 0) {
    md += '(まだ記録はありません)\n';
    return md;
  }
  const grouped = {};
  entries.forEach((e) => {
    if (!grouped[e.category]) grouped[e.category] = [];
    grouped[e.category].push(e);
  });
  order.forEach((cat) => {
    if (!grouped[cat]) return;
    md += `## ${cat}\n\n`;
    grouped[cat].forEach((e) => {
      md += `- ${e.content}\n`;
      if (e.date) md += `  (${formatDate(e.date)}の記録)\n`;
    });
    md += '\n';
  });
  return md;
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function DocSection({ title, accentColor, entries, emptyText, icon, onExport }) {
  const grouped = {};
  entries.forEach((e) => {
    if (!grouped[e.category]) grouped[e.category] = [];
    grouped[e.category].push(e.content);
  });
  const order = title === '本人専用ドラフト' ? CATEGORY_ORDER_PERSONAL : CATEGORY_ORDER_FAMILY;
  const categories = order.filter((c) => grouped[c]);

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1px solid ${LINE}`,
        borderRadius: '4px',
        padding: '20px 22px',
        marginBottom: '16px',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: accentColor,
        }}
      />
      <div
        style={{
          fontSize: '12px',
          letterSpacing: '0.05em',
          color: accentColor,
          fontWeight: 500,
          marginBottom: '4px',
          fontFamily: '"Noto Sans JP", sans-serif',
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          fontFamily: '"Noto Serif JP", Georgia, serif',
          fontSize: '18px',
          fontWeight: 600,
          color: INK,
          margin: '0 0 14px 0',
        }}
      >
        {title}
      </h3>
      {categories.length === 0 ? (
        <p
          style={{
            fontFamily: '"Noto Sans JP", sans-serif',
            fontSize: '13px',
            color: '#A8A095',
            lineHeight: 1.8,
            margin: '0 0 12px 0',
          }}
        >
          {emptyText}
        </p>
      ) : (
        categories.map((cat) => (
          <div key={cat} style={{ marginBottom: '14px' }}>
            <div
              style={{
                fontFamily: '"Noto Sans JP", sans-serif',
                fontSize: '12px',
                fontWeight: 500,
                color: '#9A9186',
                marginBottom: '6px',
                borderBottom: `1px solid ${LINE}`,
                paddingBottom: '4px',
              }}
            >
              {cat}
            </div>
            {grouped[cat].map((c, i) => (
              <p
                key={i}
                style={{
                  fontFamily: '"Noto Serif JP", Georgia, serif',
                  fontSize: '14px',
                  lineHeight: 1.9,
                  color: INK,
                  margin: '0 0 8px 0',
                }}
              >
                {c}
              </p>
            ))}
          </div>
        ))
      )}
      <button
        onClick={onExport}
        style={{
          background: 'transparent',
          border: `1px solid ${LINE}`,
          borderRadius: '4px',
          padding: '7px 14px',
          fontSize: '12px',
          color: '#8A8276',
          cursor: 'pointer',
          fontFamily: '"Noto Sans JP", sans-serif',
          marginTop: '4px',
        }}
      >
        この文書を書き出す (Markdown)
      </button>
    </div>
  );
}

function OnboardingScreen({ profile, onChange, onStart }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <p style={{ fontSize: '14px', color: INK, lineHeight: 1.9, marginBottom: '24px' }}>
        はじめまして。
        <br />
        これから少しずつ、お話を伺っていきます。
        <br />
        まずは、お呼びする名前を教えてください。
      </p>
      <input
        type="text"
        placeholder="例: 田中 太郎"
        value={profile.name}
        onChange={(e) => onChange({ ...profile, name: e.target.value })}
        style={{
          width: '220px',
          border: `1px solid ${LINE}`,
          borderRadius: '4px',
          padding: '10px 12px',
          fontSize: '14px',
          fontFamily: '"Noto Sans JP", sans-serif',
          outline: 'none',
          color: INK,
          background: PAPER,
          marginBottom: '20px',
          display: 'block',
          margin: '0 auto 20px',
        }}
      />
      <button
        onClick={onStart}
        disabled={!profile.name.trim()}
        style={{
          background: profile.name.trim() ? ACCENT : '#D8CFC0',
          color: '#FFFFFF',
          border: 'none',
          borderRadius: '4px',
          padding: '12px 28px',
          fontSize: '14px',
          fontWeight: 500,
          cursor: profile.name.trim() ? 'pointer' : 'default',
          fontFamily: '"Noto Sans JP", sans-serif',
        }}
      >
        お話を始める
      </button>
    </div>
  );
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState({ name: '' });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [personalEntries, setPersonalEntries] = useState([]);
  const [familyEntries, setFamilyEntries] = useState([]);
  const [started, setStarted] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [showPersonal, setShowPersonal] = useState(true);
  const scrollRef = useRef(null);
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef(null);
  const baseTextRef = useRef('');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        setProfile(data.profile || { name: '' });
        setMessages(data.messages || []);
        setPersonalEntries(data.personalEntries || []);
        setFamilyEntries(data.familyEntries || []);
        setOnboarded(!!data.onboarded);
        setStarted(!!data.started);
      }
    } catch (e) {
      // no saved data yet
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ profile, messages, personalEntries, familyEntries, onboarded, started })
      );
    } catch (e) {
      // ignore save errors
    }
  }, [profile, messages, personalEntries, familyEntries, onboarded, started, loaded]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }
    setSpeechSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      if (finalText) {
        baseTextRef.current = baseTextRef.current + finalText;
      }
      setInput(baseTextRef.current + interimText);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch (e) {
        // ignore
      }
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      baseTextRef.current = input ? input + (input.endsWith(' ') || input.endsWith('\n') ? '' : ' ') : '';
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        // already started
      }
    }
  };


  const sendToClaude = async (history, currentPersonal, currentFamily) => {
    setLoading(true);
    setError(null);
    try {
      const apiMessages = history.map((m) => ({ role: m.role, content: m.content }));
      const system = buildSystemPrompt(currentPersonal, currentFamily);
      const data = await callClaude(apiMessages, system);

      if (data.error) {
        setError('通信に問題が発生しました。少し時間をおいて、もう一度お試しください。');
        setLoading(false);
        return;
      }

      const textBlock = (data.content || []).find((c) => c.type === 'text');
      const raw = textBlock ? textBlock.text : '';
      const parsed = extractJson(raw);

      if (!parsed || !parsed.reply) {
        setError('お返事の準備中に問題が起きました。もう一度送ってみてください。');
        setLoading(false);
        return;
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: parsed.reply }]);

      const now = Date.now();
      if (Array.isArray(parsed.personalDraftUpdates) && parsed.personalDraftUpdates.length > 0) {
        setPersonalEntries((prev) => [
          ...prev,
          ...parsed.personalDraftUpdates.map((e) => ({ ...e, date: now })),
        ]);
      }
      if (Array.isArray(parsed.familySummaryUpdates) && parsed.familySummaryUpdates.length > 0) {
        setFamilyEntries((prev) => [
          ...prev,
          ...parsed.familySummaryUpdates.map((e) => ({ ...e, date: now })),
        ]);
      }
    } catch (e) {
      setError('通信に問題が発生しました。少し時間をおいて、もう一度お試しください。');
    }
    setLoading(false);
  };

  const handleOnboardStart = () => {
    setOnboarded(true);
    setStarted(true);
    const greeting = {
      role: 'user',
      content: `(対話を始めてください。利用者の名前は「${profile.name}」さんです。温かく挨拶し、今日話したいことをやさしく尋ねてください。)`,
    };
    sendToClaude([greeting], personalEntries, familyEntries);
  };

  const handleSend = () => {
    if (!input.trim() || loading) return;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    baseTextRef.current = '';
    const newMessages = [...messages, { role: 'user', content: input.trim() }];
    setMessages(newMessages);
    setInput('');
    sendToClaude(newMessages, personalEntries, familyEntries);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewSession = () => {
    const prompt = {
      role: 'user',
      content:
        '(次の対話セッションを始めてください。前回までの記録を踏まえ、まだ聞いていない話題について、温かく話しかけてください。)',
    };
    const newMessages = [...messages, prompt];
    setMessages(newMessages);
    sendToClaude(newMessages, personalEntries, familyEntries);
  };

  const handleExportPersonal = () => {
    const md = buildMarkdown(
      '本人専用ドラフト',
      personalEntries,
      CATEGORY_ORDER_PERSONAL,
      profile
    );
    downloadFile(`本人専用ドラフト_${profile.name || 'のこす言葉'}.md`, md);
  };

  const handleExportFamily = () => {
    const md = buildMarkdown('家族向け要約', familyEntries, CATEGORY_ORDER_FAMILY, profile);
    downloadFile(`家族向け要約_${profile.name || 'のこす言葉'}.md`, md);
  };

  const handleReset = async () => {
    if (!window.confirm('すべての記録を消去します。本当によろしいですか?')) return;
    setProfile({ name: '' });
    setMessages([]);
    setPersonalEntries([]);
    setFamilyEntries([]);
    setOnboarded(false);
    setStarted(false);
    try {
      await window.storage.delete(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  };

  if (!loaded) {
    return (
      <div style={{ fontFamily: '"Noto Sans JP", sans-serif', padding: '40px', textAlign: 'center', color: '#9A9186' }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: '"Noto Sans JP", sans-serif',
        background: PAPER,
        minHeight: '700px',
        padding: '32px',
        boxSizing: 'border-box',
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;600&family=Noto+Sans+JP:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.44.0/iconfont/tabler-icons.min.css"
      />
      <div style={{ textAlign: 'center', marginBottom: '28px', position: 'relative' }}>
        <h1
          style={{
            fontFamily: '"Noto Serif JP", Georgia, serif',
            fontSize: '26px',
            fontWeight: 600,
            color: INK,
            margin: '0 0 6px 0',
            letterSpacing: '0.06em',
          }}
        >
          のこす言葉
        </h1>
        <p style={{ fontSize: '13px', color: '#9A9186', margin: 0, letterSpacing: '0.04em' }}>
          話すだけで、おもいでと大切なことを記録します
        </p>
        {onboarded && (
          <button
            onClick={handleReset}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: 'transparent',
              border: `1px solid ${LINE}`,
              borderRadius: '4px',
              padding: '6px 12px',
              fontSize: '11px',
              color: '#A8A095',
              cursor: 'pointer',
              fontFamily: '"Noto Sans JP", sans-serif',
            }}
          >
            記録をすべて消す
          </button>
        )}
      </div>

      {!onboarded ? (
        <div
          style={{
            maxWidth: '480px',
            margin: '0 auto',
            background: '#FFFFFF',
            border: `1px solid ${LINE}`,
            borderRadius: '4px',
          }}
        >
          <OnboardingScreen profile={profile} onChange={setProfile} onStart={handleOnboardStart} />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div
            style={{
              flex: '1 1 360px',
              minWidth: '320px',
              background: '#FFFFFF',
              border: `1px solid ${LINE}`,
              borderRadius: '4px',
              display: 'flex',
              flexDirection: 'column',
              height: '560px',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                borderBottom: `1px solid ${LINE}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontFamily: '"Noto Serif JP", Georgia, serif',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: INK,
                }}
              >
                {profile.name} さんとのお話
              </span>
              <button
                onClick={handleNewSession}
                disabled={loading}
                style={{
                  background: 'transparent',
                  border: `1px solid ${LINE}`,
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  color: loading ? '#D8CFC0' : '#8A8276',
                  cursor: loading ? 'default' : 'pointer',
                  fontFamily: '"Noto Sans JP", sans-serif',
                }}
              >
                新しい話題を聞く
              </button>
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '18px' }}>
              {messages.map((m, i) => {
                if (m.content.startsWith('(') && m.content.endsWith(')')) return null;
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                      marginBottom: '12px',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '85%',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        fontSize: '14px',
                        lineHeight: 1.8,
                        background: m.role === 'user' ? '#F1E9DC' : PAPER,
                        color: INK,
                        border: m.role === 'user' ? 'none' : `1px solid ${LINE}`,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })}

              {loading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      color: '#9A9186',
                      border: `1px solid ${LINE}`,
                    }}
                  >
                    考えています...
                  </div>
                </div>
              )}

              {error && (
                <div style={{ textAlign: 'center', marginTop: '12px' }}>
                  <p style={{ fontSize: '13px', color: '#B5544A' }}>{error}</p>
                </div>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${LINE}`, padding: '12px 14px', display: 'flex', gap: '8px' }}>
              <textarea
                value={input}
                onChange={(e) => {
                  baseTextRef.current = e.target.value;
                  setInput(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? '聞いています...' : 'ここに書いてください、または右のマイクで話してください'}
                rows={2}
                style={{
                  flex: 1,
                  resize: 'none',
                  border: `1px solid ${isListening ? ACCENT : LINE}`,
                  borderRadius: '4px',
                  padding: '10px 12px',
                  fontSize: '14px',
                  fontFamily: '"Noto Sans JP", sans-serif',
                  outline: 'none',
                  color: INK,
                  background: PAPER,
                }}
              />
              {speechSupported && (
                <button
                  onClick={toggleListening}
                  disabled={loading}
                  title={isListening ? '音声入力を止める' : '音声入力を始める'}
                  style={{
                    background: isListening ? ACCENT : 'transparent',
                    color: isListening ? '#FFFFFF' : '#8A8276',
                    border: `1px solid ${isListening ? ACCENT : LINE}`,
                    borderRadius: '4px',
                    width: '44px',
                    flexShrink: 0,
                    cursor: loading ? 'default' : 'pointer',
                    fontSize: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  🎙
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                style={{
                  background: loading || !input.trim() ? '#D8CFC0' : ACCENT,
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0 18px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: loading || !input.trim() ? 'default' : 'pointer',
                  fontFamily: '"Noto Sans JP", sans-serif',
                }}
              >
                送る
              </button>
            </div>
          </div>

          <div style={{ flex: '1 1 320px', minWidth: '300px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button
                onClick={() => setShowPersonal(true)}
                style={{
                  flex: 1,
                  background: showPersonal ? '#FFFFFF' : 'transparent',
                  border: `1px solid ${LINE}`,
                  borderRadius: '4px',
                  padding: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: showPersonal ? SAGE : '#A8A095',
                  cursor: 'pointer',
                  fontFamily: '"Noto Sans JP", sans-serif',
                }}
              >
                本人専用ドラフト
              </button>
              <button
                onClick={() => setShowPersonal(false)}
                style={{
                  flex: 1,
                  background: !showPersonal ? '#FFFFFF' : 'transparent',
                  border: `1px solid ${LINE}`,
                  borderRadius: '4px',
                  padding: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: !showPersonal ? ACCENT : '#A8A095',
                  cursor: 'pointer',
                  fontFamily: '"Noto Sans JP", sans-serif',
                }}
              >
                家族向け要約
              </button>
            </div>

            {showPersonal ? (
              <DocSection
                title="本人専用ドラフト"
                accentColor={SAGE}
                icon="PRIVATE — 本人のみ"
                entries={personalEntries}
                emptyText="お話が進むと、ここに資産や持ち物、大切な記録が書き加えられていきます。"
                onExport={handleExportPersonal}
              />
            ) : (
              <DocSection
                title="家族向け要約"
                accentColor={ACCENT}
                icon="SHARED — ご家族へ"
                entries={familyEntries}
                emptyText="ご家族に伝えたいお気持ちが見つかると、ここにやさしい言葉でまとめられます。"
                onExport={handleExportFamily}
              />
            )}

            <div
              style={{
                fontSize: '12px',
                color: '#A8A095',
                lineHeight: 1.8,
                marginTop: '4px',
                padding: '0 4px',
              }}
            >
              記録はこの端末に保存されます。「新しい話題を聞く」を押すと、まだお話していないことについてやさしく聞いていきます。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
