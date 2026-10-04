import type { StorybookConfig } from "@storybook/react-vite";

// Local component-state review only: no addons, no telemetry, no hosted service, loopback dev server.
const config: StorybookConfig = {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: ["../src/**/*.stories.tsx"],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  typescript: { reactDocgen: false },
};

export default config;
