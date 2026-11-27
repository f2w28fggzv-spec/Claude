// The app's own Vite config (vite.config.ts) without the landing page's build:
// landing:check builds the app with it too, and checks that the app's files
// and sw.js come out byte for byte the same as in the full build (the app
// never depends on the page). Not used anywhere else. vite.config.ts exports a
// function of the mode (the iPhone app's build is mode "native"), so this does too.
import appConfig from '../../vite.config.ts';

const isLanding = (plugin) => !!plugin && typeof plugin.name === 'string' && plugin.name.startsWith('fitee-landing');

export default (env) => {
  const config = typeof appConfig === 'function' ? appConfig(env) : appConfig;
  return { ...config, plugins: config.plugins.flat(Infinity).filter((p) => !isLanding(p)) };
};
