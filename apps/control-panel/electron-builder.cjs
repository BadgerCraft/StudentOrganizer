// Separate identity and artifacts; --publish never is also enforced by root scripts.
module.exports = {
  appId: 'ca.badgercraft.studentorganizer.controlpanel',
  productName: 'Student Organizer Control Panel',
  directories: { app: 'apps/control-panel', output: 'release/control-panel' },
  // electron-builder searches parent dependencies when the app has none.
  // This dependency-free shell uses built-ins plus its prebundled renderer only.
  files: ['dist/**/*', 'electron/**/*', 'package.json', '!**/node_modules/**/*'],
  extraResources: [{ from: 'electron', to: 'owner-update-contract', filter: ['updateApproval.cjs', 'releaseDelivery.cjs', 'manualUpdater.cjs', 'windowsInstallerUpdate.cjs'] }],
  publish: null,
  win: { target: ['nsis'], artifactName: 'StudentOrganizerControlPanel-${version}-${arch}.${ext}' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.utilities', identity: null,
    artifactName: 'StudentOrganizerControlPanel-${version}-mac-${arch}.${ext}' }
};
