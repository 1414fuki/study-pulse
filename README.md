# Study Pulse

個人向けの学習タイマー・タスク管理・ルーティン・振り返りアプリです。

## 使い方

### ローカルで使う

```bash
cd study-app-pwa
python -m http.server 8080 --bind 0.0.0.0
```

ブラウザで以下を開きます。

- http://localhost:8080
- または LAN 上の端末から http://<PCのIP>:8080

### 公開用URLにする

このサイトは静的ファイル構成のため、以下にそのままデプロイできます。

- Netlify
- Cloudflare Pages
- GitHub Pages

#### Netlify の例

1. このフォルダを GitHub に push
2. Netlify で GitHub リポジトリを接続
3. Publish directory を `.` に設定
4. Deploy

#### GitHub Pages の例

1. このフォルダを public リポジトリに push
2. GitHub Pages の設定で `main` ブランチを公開
3. `index.html` が公開される

## 重要事項

- ローカルデータはブラウザの `localStorage` に保存されます
- 共有利用をする場合は、各端末ごとにデータが分かれます
- 公開URLで使う場合は、ブラウザの制約により通知やアラームの挙動が端末依存になります
