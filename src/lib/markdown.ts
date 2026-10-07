// Sätteri mdast plugin for report markdown, which Claude writes. Raw HTML becomes visible plain text,
// and images become their alt text, so a report can never inject markup, scripts, or remote images.
import { defineMdastPlugin } from 'satteri';

export const safeMarkdown = defineMdastPlugin({
  name: 'safe-markdown',
  html(node, ctx) {
    ctx.replaceNode(node, { type: 'text', value: node.value });
  },
  image(node, ctx) {
    ctx.replaceNode(node, { type: 'text', value: node.alt ?? '' });
  },
});
