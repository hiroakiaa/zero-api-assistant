# ZERO

無料API、Google Apps Script（GAS）、非公開Googleスプレッドシートで動く日本語の会話型アシスタント。生成言語モデルは使いません。通訳君を参考にした黒基調の操作画面です。

## 構成

GitHubでソースを管理し、GitHub PagesからGASのWebアプリを表示します。GASのHTML画面から `google.script.run` を呼び出す構成により、クロスオリジンの保存APIにJSONPやno-corsを使う必要がありません。埋め込みが制限されるブラウザでは「別画面で開く」を使います。

- `index.html`：GitHub Pagesの入口
- `config.js`：GASの公開URL（秘密鍵は含みません）
- `App.html`：GASが表示する画面と会話処理
- `Code.gs`：API取得、利用制限、データベース処理
- `Config.gs`：データベースのファイルID。ファイル自体は非公開のまま利用
- `appsscript.json`：GAS実行設定
- `preview.html`：GAS未接続でも実データ取得を試せる画面。履歴は保存しません

## データベース

| シート | 用途 |
| --- | --- |
| Settings | アプリ名、見出し、履歴保存の有効・無効 |
| Providers | 利用するAPIの有効・無効、ライセンス、出典 |
| Conversations | 会話ID、所有者ハッシュ、題名、日時、会話条件 |
| Messages | メッセージID、所有者ハッシュ、会話ID、発言、日時、出典 |

各シートの1行目は列名です。列名・順序を変更するとGASは処理を停止します。

## 利用できる機能

天気の取得と最大3都市の比較、服装の目安、日の出・日の入り、通貨換算、Wikipedia本文抜粋、書籍検索、生命科学文献、USGSの重要地震、World Bankの首都・人口、Hacker Newsの技術記事、日本の祝日、計算、世界時計。続く質問に都市や日付、書籍・文献の検索条件を引き継ぎます。一般的な雑談・創作・自由な推論には対応していません。

## 保存とアクセス

GAS接続時は質問・回答・会話条件を保存します。ブラウザ内で作った256ビットのランダムな識別情報をリクエストごとに送信し、サーバーではSHA-256ハッシュとして照合します。他の利用者の会話一覧・本文は返しません。同じブラウザ・プロファイルを共有する人は同じ履歴にアクセスできます。ブラウザデータを削除した場合や、ブラウザが埋め込み画面のストレージを制限した場合、過去の履歴に再接続できないことがあります。この識別方式はGoogleアカウント認証の代わりとなる機密データ保管の仕組みではありません。

スプレッドシートの管理者は保存された会話を閲覧できます。データベースの共有範囲は拡大しないでください。GASのWebアプリはデプロイしたユーザーとして実行します。公開URLには匿名アクセスを許可しますが、履歴の取得・保存は識別情報ごとに制限されます。

## 費用と制限

有料API、試用クレジット、カード登録が必要な接続先は使いません。料金を要求しない公開APIと端末内の処理を使い、負荷制限や利用条件に従います。上限時に課金へ切り替える処理はありません。詳細は `POLICY.md` と `providers.json` を確認してください。

1ブラウザ識別情報につき毎時120リクエスト、アプリ全体で1日1000件の外部API新規取得、1会話100発言、1利用者50会話、各データシート20000行をアプリ側の負荷保護上限としています。購入クレジットではありません。GitHub・GAS等にも実行・容量の上限があり、無制限の稼働は保証しません。API応答をキャッシュして負荷を抑えます。

## 更新

GASに `Code.gs`, `Config.gs`, `App.html`, `appsscript.json` を反映し、既存デプロイを新しいバージョンへ更新します。`config.js` のURLを維持すればGitHub Pagesの入口はそのまま使えます。画面を編集するときは `App.html` とプレビューを同じ状態に保ってください。

初回は所有者によるGoogleの権限承認が必要です。必要な権限はスプレッドシートへの読み書きと外部サービスへの通信です。

## API出典

- [MET Norway](https://api.met.no/doc/TermsOfService)
- [Frankfurter](https://frankfurter.dev/)
- [Wikipedia / MediaWiki](https://www.mediawiki.org/wiki/API:Main_page)
- [Holidays JP](https://github.com/holidays-jp/api)
- [Open Library](https://openlibrary.org/developers/api)
- [Europe PMC](https://europepmc.org/RestfulWebService)
- [USGS](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
- [World Bank](https://datacatalog.worldbank.org/public-licenses)
- [Hacker News](https://github.com/HackerNews/API)
- [FreeDictionaryAPI.com](https://freedictionaryapi.com/)：Wiktionaryの英英辞書。`辞書: hello`、`appleの意味は？`で定義とIPA発音記号を取得。本文は[Wiktionary執筆者](https://en.wiktionary.org/)による[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)のデータから最大3件を原文抜粋し、回答ごとに元記事とライセンスを表示します。日本語への翻訳は生成しません。
