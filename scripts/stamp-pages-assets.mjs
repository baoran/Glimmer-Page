import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const indexPath = resolve(process.cwd(), "site", "index.html");
const version = String(process.argv[2] || process.env.GITHUB_SHA || Date.now()).slice(0, 20);
const html = await readFile(indexPath, "utf8");
if (!/\.\/styles\.css(?:\?v=[^"']*)?/.test(html) || !/\.\/app\.js(?:\?v=[^"']*)?/.test(html)) {
  throw new Error("没有找到需要版本化的静态资源引用");
}
const stamped = html
  .replace(/\.\/styles\.css(?:\?v=[^"']*)?/g, `./styles.css?v=${version}`)
  .replace(/\.\/app\.js(?:\?v=[^"']*)?/g, `./app.js?v=${version}`);

if (stamped !== html) await writeFile(indexPath, stamped, "utf8");
console.log(`静态资源版本已更新：${version}`);
