import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

/** CLI metadata is read afresh, never taken from a stored connection or SDK serverInfo.
 * Passing this gate does not establish capabilities; the existing SDK handshake still follows.
 */
export async function probeDshVersion(invocation, { cwd, execute = executeFile } = {}) {
  let cliVersion = null;
  try {
    const result = await execute(invocation.binary, invocation.args, {
      cwd, timeout: 4000, maxBuffer: 32768, windowsHide: true,
      env: { ...process.env, ...invocation.env },
    });
    cliVersion = /\b\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?\b/.exec(String(result.stdout ?? ''))?.[0] ?? null;
  } catch { /* A missing or failing metadata command is not proof of compatibility. */ }
  if (!cliVersion) return { cliVersion: null, blocked: true, reason: 'unknown', note: '无法确认此 DSH CLI 的实际版本，未建立连接。请核对 DSH 启动入口和 --version 输出；企业 Web 版需要该版本的接口文档。' };
  if (cliVersion.split('+')[0] === '0.2.0-rc.2') return { cliVersion, blocked: true, reason: 'unsupported-version', note: `DSH ${cliVersion} 对应的上游 SDK 缺少 QuanDeck 所需的权限回执、问题交互和跨进程恢复协议，未建立连接。企业版若回移了这些功能，需要该版本的接口文档验证。` };
  return { cliVersion, blocked: false, reason: null, note: 'CLI 版本已读取；仍须核对已适配的 SDK 协议，版本号本身不证明能力。' };
}
