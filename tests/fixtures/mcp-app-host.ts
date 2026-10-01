import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

type Result = Parameters<AppBridge['sendToolResult']>[0];
declare global {
  interface Window {
    mcpTestHost: {
      mount(html: string, result: Result, arguments?: Record<string, unknown>): Promise<void>;
      nextResult: Result;
      calls: Array<{ name: string; arguments?: Record<string, unknown> }>;
      theme(value: 'dark' | 'light'): void;
    };
  }
}

let bridge: AppBridge | undefined;
window.mcpTestHost = {
  nextResult: { content: [] },
  calls: [],
  async mount(html, result, input) {
    if (bridge) await bridge.close();
    const iframe = document.getElementById('app') as HTMLIFrameElement;
    window.mcpTestHost.nextResult = result;
    bridge = new AppBridge(
      null,
      { name: 'Test MCP Apps host', version: '1' },
      { serverTools: {} },
      { hostContext: { theme: 'dark' } },
    );
    const host = bridge;
    host.oncalltool = async (params) => {
      window.mcpTestHost.calls.push(params);
      return window.mcpTestHost.nextResult;
    };
    const initialized = new Promise<void>((resolve, reject) => {
      host.oninitialized = () => {
        void host
          .sendToolInput({
            arguments: input ?? { path: { id: '0193b3c0-f1f0-7000-8000-00000000a001' } },
          })
          .then(() => host.sendToolResult(result))
          .then(resolve, reject);
      };
    });
    await host.connect(
      new PostMessageTransport(iframe.contentWindow as Window, iframe.contentWindow as Window),
    );
    iframe.srcdoc = html;
    await initialized;
  },
  theme(value) {
    bridge?.setHostContext({ theme: value });
  },
};
