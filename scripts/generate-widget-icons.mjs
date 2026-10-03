import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Circle, CircleCheck, Pause, Play, Plus, RefreshCw, Settings2, SquarePen, Undo2, X } from "lucide-react";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const resources = resolve("src-tauri/gen/android/app/src/main/res");
const icons = { play: Play, pause: Pause, add: Plus, refresh: RefreshCw, configure: Settings2, edit: SquarePen, undo: Undo2, unchecked: Circle, checked: CircleCheck, close: X };

function pathData(element) {
  const number = (name) => Number(element.getAttribute(name));
  switch (element.tagName) {
    case "path": return element.getAttribute("d");
    case "line": return `M${number("x1")},${number("y1")} L${number("x2")},${number("y2")}`;
    case "polyline": return `M${element.getAttribute("points")}`;
    case "rect": {
      const left = number("x"), top = number("y"), width = number("width"), height = number("height");
      const right = left + width, bottom = top + height;
      const radius = Math.min(number("rx"), width / 2, height / 2);
      if (!radius) return `M${left},${top} H${right} V${bottom} H${left} Z`;
      return `M${left + radius},${top} H${right - radius} A${radius},${radius} 0 0,1 ${right},${top + radius} V${bottom - radius} A${radius},${radius} 0 0,1 ${right - radius},${bottom} H${left + radius} A${radius},${radius} 0 0,1 ${left},${bottom - radius} V${top + radius} A${radius},${radius} 0 0,1 ${left + radius},${top} Z`;
    }
    case "circle": {
      const centerX = number("cx"), centerY = number("cy"), radius = number("r");
      return `M${centerX - radius},${centerY} a${radius},${radius} 0 1,0 ${radius * 2},0 a${radius},${radius} 0 1,0 ${-radius * 2},0`;
    }
    default: throw new Error(`Unsupported Lucide shape: ${element.tagName}`);
  }
}

for (const [name, icon] of Object.entries(icons)) {
  const svg = renderToStaticMarkup(createElement(icon, { size: 24, strokeWidth: 2 }));
  const document = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  const paths = [...document.documentElement.children].map((element) => `    <path android:pathData="${pathData(element)}" android:fillColor="@android:color/transparent" android:strokeColor="#5179C7" android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round" />`);
  const vector = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">\n${paths.join("\n")}\n</vector>\n`;
  await writeFile(resolve(resources, "drawable", `widget_ic_${name}.xml`), vector);
}
await mkdir(resolve(resources, "raw"), { recursive: true });
const packageRoot = dirname(require.resolve("lucide-react/package.json"));
await writeFile(resolve(resources, "raw/lucide_license.txt"), await readFile(resolve(packageRoot, "LICENSE")));
console.log(`Generated ${Object.keys(icons).length} Android vectors from the installed Lucide library.`);