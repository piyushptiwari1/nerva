import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";

const adb = process.argv[2] || process.env.ADB || "adb";
const booted = execFileSync(adb, ["shell", "getprop", "sys.boot_completed"], { encoding: "utf8", timeout: 15000 }).trim();
if (booted !== "1") {
  await new Promise((resolve, reject) => {
    const deviceLog = spawn(adb, ["logcat", "-b", "events", "-v", "brief", "boot_progress_enable_screen:I", "*:S"], { stdio: ["ignore", "pipe", "inherit"] });
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
    const deadline = setTimeout(() => finish(new Error("Android did not reach display-ready boot state within 120 seconds")), 120000);
    lines.on("line", (line) => { if (line.includes("boot_progress_enable_screen")) finish(); });
    deviceLog.on("error", finish);
    deviceLog.on("exit", (code) => { if (!finished) finish(new Error(`Android boot log ended before readiness (${code})`)); });
  });
}
console.log("Android framework boot readiness confirmed");