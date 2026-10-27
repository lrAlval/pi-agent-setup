export const Key = { tab: "tab", right: "right", escape: "escape" };
export const matchesKey = (data, key) => data === `<${key}>` || data === key;
export const visibleWidth = (s) => [...String(s)].length;
export const truncateToWidth = (s, n) => String(s).slice(0, Math.max(0, n));
export const wrapTextWithAnsi = (text, _width) => [String(text)];
