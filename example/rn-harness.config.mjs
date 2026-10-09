import {
  applePlatform,
  appleSimulator,
} from '@react-native-harness/platform-apple';

// Override per machine, e.g. HARNESS_IOS_SIMULATOR="Columnar 17 Pro Max" HARNESS_METRO_PORT=8092
const simulator = process.env.HARNESS_IOS_SIMULATOR || 'iPhone 17 Pro Max';
const iosVersion = process.env.HARNESS_IOS_VERSION || '26.5';
const metroPort = Number(process.env.HARNESS_METRO_PORT || 8081);

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'ColumnarExample',
  metroPort,
  runners: [
    applePlatform({
      name: 'ios',
      device: appleSimulator(simulator, iosVersion),
      bundleId: 'columnar.example',
    }),
  ],
  defaultRunner: 'ios',
  forwardClientLogs: true,
};
