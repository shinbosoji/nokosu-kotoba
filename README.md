# のこす言葉 (Nokosu Kotoba)

話すだけで、おもいでと大切なことを記録するアプリ。
Claude (claude-sonnet-4-6) と週次の対話を行い、「本人専用ドラフト」と「家族向け要約」の
2つの文書を自動で更新する、シニア層向けのライフログ/資産ドシエサービス。

## 構成

```
nokosu-kotoba-pwa/
├── index.html          # エントリーHTML (PWAメタタグ含む)
├── manifest.json (public/) # PWAマニフェスト
├── service-worker.js (public/) # オフラインキャッシュ
├── src/
│   ├── App.jsx          # メインアプリ (チャットUI + 音声入力 + 文書ビュー)
│   └── main.jsx         # Reactエントリーポイント
├── api/
│   └── chat.js          # Claude APIへのサーバーサイドプロキシ (Vercel Functions)
├── public/
│   ├── icon-192.png
│   └── icon-512.png
├── package.json
└── vite.config.js
```

## ローカル開発

```bash
npm install
npm run dev
```

`/api/chat` はVercelのサーバーレス関数として動作するため、ローカルでは
`vercel dev` を使うか、別途Expressサーバーでプロキシしてください。

## デプロイ (Vercel推奨)

1. このリポジトリをGitHubにpush
2. Vercelで新規プロジェクトとしてimport
3. Environment Variablesに `ANTHROPIC_API_KEY` を設定 (Anthropic Consoleで取得)
4. デプロイ

これでPWA(Webアプリ)として、スマートフォンの「ホーム画面に追加」から
アプリのように利用できます。

---

## ストア申請 (App Store / Google Play) への道筋

PWAをそのままネイティブアプリ化するには **Capacitor** を使うのが最も簡単です。
以下、想定される全体スケジュールと必要な準備です。

### 1. 事前準備 (アカウント・費用)

| 項目 | 費用 | 備考 |
|---|---|---|
| Apple Developer Program | $99/年 | 個人または法人名義。審査に1〜2日 |
| Google Play Console | $25 (一度のみ) | 個人アカウントでも登録可能 |
| プライバシーポリシーURL | 無料 | 本サービスは資産・個人情報を扱うため必須。Vercel上に静的ページとして公開可能 |
| Apple/Googleの本人確認 | - | 個人事業主の場合は氏名・住所の確認書類が必要な場合あり |

### 2. Capacitorによるネイティブ化

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "のこす言葉" "com.example.nokosukotoba"
npm run build
npx cap add ios
npx cap add android
npx cap sync
```

- `npx cap open ios` → Xcodeが起動 → ビルド・実機テスト・アーカイブ
- `npx cap open android` → Android Studioが起動 → ビルド・APK/AAB生成

### 3. 音声入力に関する注意 (重要)

現在のWeb Speech APIはブラウザ(WebView)上で動作しますが、
ネイティブアプリのWebView内では音声認識のマイク許可が
OS側の権限設定 (Info.plist / AndroidManifest.xml) と連動する必要があります。

- iOS: `Info.plist` に `NSMicrophoneUsageDescription` と
  `NSSpeechRecognitionUsageDescription` を追加
- Android: `AndroidManifest.xml` に `RECORD_AUDIO` 権限を追加

Capacitorの公式プラグイン `@capacitor-community/speech-recognition` を使うと、
ネイティブの音声認識エンジンを直接呼び出せるため、Web Speech APIより
安定する場合があります(無料・追加コストなし)。

```bash
npm install @capacitor-community/speech-recognition
npx cap sync
```

### 4. ストア申請に必要なアセット

- アプリアイコン (1024x1024、角丸なし) — `public/icon-512.png` を基に作成
- スクリーンショット (各デバイスサイズ、最低3〜5枚)
- アプリの説明文・キーワード(日本語)
- プライバシーポリシー(資産・個人情報を扱うため特に重要。
  「対話内容の保存範囲」「第三者提供の有無」「データ削除方法」を明記)
- App Storeの「データ収集に関する開示」(プライバシーラベル)
- コンテンツレーティング(Google Play Console上で質問に回答)

### 5. 審査時の注意点

- **個人情報を扱うアプリ**として、両ストアともプライバシーポリシーの内容と
  実際の挙動の一致を厳しく審査します。本サービスは「対話履歴をサーバーに
  保存するか」「Claude APIに送信される内容」を正確に開示してください。
- Appleは「単なるWebサイトのラッパー」と判断したアプリを却下する場合が
  あります。音声入力・通知・ホーム画面連携など、ネイティブらしい機能を
  含めることで通過率が上がります。
- 初回審査は1〜3日(Apple)、数時間〜数日(Google)が目安です。

### 6. 推奨スケジュール

1. Vercelへのデプロイ・PWA動作確認 (即日)
2. Capacitorでのネイティブラッパー作成・実機テスト (3〜5日)
3. ストアアカウント登録・本人確認 (1〜3日、Appleは時間がかかる場合あり)
4. アセット準備・プライバシーポリシー作成 (2〜3日)
5. 審査提出 → 通過まで (Apple: 1〜3日 / Google: 数時間〜数日)

---

## コスト

- Claude API: 対話1回あたり約 $0.005〜0.01 (claude-sonnet-4-6, max_tokens=1000)
- Vercelホスティング: 無料プラン(Hobby)で個人利用は十分
- 音声入力: Web Speech API / ネイティブ音声認識ともに無料

唯一の継続コストはClaude APIの利用料のみです。
