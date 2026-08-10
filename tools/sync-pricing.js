#!/usr/bin/env node
/**
 * apply/config-schema.js を gas/pricing.gs へ同期する。
 *
 * 料金計算はフォーム表示・確認メール・サーバ側の再計算のすべてで一致していなければ
 * ならない。GAS は npm のモジュールを読めないため実体を2箇所に置かざるを得ないが、
 * 手で写すと必ずずれるので、コピーは常にこのスクリプトで行う。
 *
 *   確認: node tools/sync-pricing.js --check   （ずれていれば終了コード1）
 *   反映: node tools/sync-pricing.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'apply', 'config-schema.js');
const DEST = path.join(__dirname, '..', 'gas', 'pricing.gs');

const HEADER = `/**
 * === 自動生成ファイル・直接編集しないでください ===
 *
 * apply/config-schema.js から tools/sync-pricing.js が生成しています。
 * 変更する場合は apply/config-schema.js を編集し、次を実行してください:
 *
 *     node tools/sync-pricing.js
 *
 * 料金計算をフロントとサーバで一致させるための複製です。
 */

`;

/** Node 用の module.exports ブロックを除去する（GAS には module がない） */
function toGasSource(src) {
  const marker = "// Node（テスト実行）向けエクスポート";
  const idx = src.indexOf(marker);
  const body = idx >= 0 ? src.slice(0, idx) : src;
  return HEADER + body.trimEnd() + '\n';
}

function main() {
  const src = fs.readFileSync(SRC, 'utf8');
  const expected = toGasSource(src);
  const check = process.argv.includes('--check');

  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  const current = fs.existsSync(DEST) ? fs.readFileSync(DEST, 'utf8') : null;

  if (current === expected) {
    console.log('gas/pricing.gs は最新です');
    return 0;
  }

  if (check) {
    console.error('gas/pricing.gs が apply/config-schema.js とずれています。');
    console.error('node tools/sync-pricing.js を実行してください。');
    return 1;
  }

  fs.writeFileSync(DEST, expected);
  console.log('gas/pricing.gs を更新しました');
  return 0;
}

process.exit(main());
