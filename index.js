import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// Without this, the native side cannot find the 'main' module and the app
// crashes on launch with a fatal JS exception.
registerRootComponent(App);
