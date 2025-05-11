# VSCode Linear Extension

VSCode 上で Linear の issue を管理するための拡張機能です。

## 機能

- Linear issue の一覧表示
- 自分にアサインされた issue のフィルタリング
- issue 詳細の表示
- issue へのコメント機能

## 必要条件

- VSCode 1.60.0 以上
- Linear API トークン

## インストール方法

1. VSCode の拡張機能マーケットプレイスからインストール
2. Linear API トークンを設定
   - Linear の Settings > API > Personal API tokens からトークンを取得
   - VSCode の設定から`linear.apiToken`にトークンを設定

## 使い方

1. VSCode のサイドバーから Linear アイコンをクリック
2. issue 一覧が表示されます
3. フィルターアイコンをクリックすることで、自分にアサインされた issue のみを表示できます
4. issue をクリックすると詳細が表示され、コメントを追加することができます

## 開発方法

```bash
# 依存関係のインストール
npm install

# 開発モードで実行
npm run watch

# VSCodeでデバッグ実行
F5キーを押してデバッグを開始
```

## ライセンス

MIT

## 作者

matsurih
