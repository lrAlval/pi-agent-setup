const stubs = {
  "@earendil-works/pi-agent-core": "./stub-pi-agent-core.mjs",
  "@earendil-works/pi-ai": "./stub-pi-ai.mjs",
  "@earendil-works/pi-coding-agent": "./stub-pi-coding-agent.mjs",
  "@earendil-works/pi-tui": "./stub-pi-tui.mjs",
};

export async function resolve(specifier, context, next) {
  if (specifier in stubs) {
    return { url: new URL(stubs[specifier], import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
