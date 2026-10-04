import type { Preview } from "@storybook/react-vite";
import "katex/dist/katex.min.css";
import "../src/styles.css";

// The same tokens as the app: the toolbar switches the `data-theme` attribute the app itself uses.
const preview: Preview = {
  globalTypes: {
    theme: { description: "App theme", toolbar: { title: "Theme", items: [{ value: "light", title: "Light" }, { value: "dark", title: "Dark" }], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, context) => {
      document.documentElement.setAttribute("data-theme", String(context.globals.theme ?? "light"));
      return (
        <div className="min-h-dvh bg-bg p-4 text-ink">
          <Story />
        </div>
      );
    },
  ],
  parameters: { layout: "fullscreen", controls: { disable: true } },
};

export default preview;
