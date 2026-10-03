import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const adb = process.argv[2] || process.env.ADB || "adb";
const targetPackage = process.argv[3];

function awaitEvent(event, matches, description) {
  return new Promise((resolve, reject) => {
    const deviceLog = spawn(adb, ["logcat", "-b", "events", "-v", "brief", `${event}:I`, "*:S"], { stdio: ["ignore", "pipe", "inherit"] });
    const lines = createInterface({ input: deviceLog.stdout });
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      lines.close();
      deviceLog.kill();
      if (error) reject(error);
      else resolve();
    };
    const deadline = setTimeout(() => finish(new Error(`Android did not reach ${description} within 120 seconds`)), 120000);
    lines.on("line", (line) => { if (line.includes(event) && matches(line)) finish(); });
    deviceLog.on("error", finish);
    deviceLog.on("exit", (code) => { if (!finished) finish(new Error(`Android boot log ended before readiness (${code})`)); });
  });
}

const booted = execFileSync(adb, ["shell", "getprop", "sys.boot_completed"], { encoding: "utf8", timeout: 15000 }).trim();
if (booted !== "1") await awaitEvent("boot_progress_enable_screen", () => true, "display-ready boot state");

if (targetPackage) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(targetPackage)) throw new Error("Invalid Android package name");
  const process = spawnSync(adb, ["shell", "pidof", targetPackage], { encoding: "utf8", timeout: 15000 });
  if (process.error) throw process.error;
  if (process.status !== 0 || !process.stdout.trim()) {
    await awaitEvent("am_proc_bound", (line) => {
      const fields = line.slice(line.lastIndexOf("[") + 1, line.lastIndexOf("]")).split(",").map((field) => field.trim());
      return fields[2] === targetPackage;
    }, `${targetPackage} to start naturally after unlock`);
  }
  console.log(`Android recovered process confirmed: ${targetPackage}`);
}
console.log("Android framework boot readiness confirmed");