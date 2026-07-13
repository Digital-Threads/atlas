import { spawn } from "node:child_process";

export interface BrowserLaunch {
  command: string;
  args: string[];
}

export function getBrowserLaunch(target: string, platform: NodeJS.Platform = process.platform): BrowserLaunch {
  if (platform === "win32") return { command: "explorer.exe", args: [target] };
  if (platform === "darwin") return { command: "open", args: [target] };
  return { command: "xdg-open", args: [target] };
}

export async function openBrowser(target: string): Promise<void> {
  const launch = getBrowserLaunch(target);
  const child = spawn(launch.command, launch.args, { detached: true, stdio: "ignore", windowsHide: true });
  await new Promise<void>((resolvePromise, reject) => {
    child.once("spawn", resolvePromise);
    child.once("error", reject);
  });
  child.unref();
}
