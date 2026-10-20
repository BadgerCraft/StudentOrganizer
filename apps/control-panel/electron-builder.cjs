// Separate identity and artifacts; --publish never is also enforced by root scripts.
module.exports = {
  appId: 'ca.badgercraft.studentorganizer.controlpanel',
  productName: 'Student Organizer Control Panel',
  directories: { app: 'apps/control-panel', output: 'release/control-panel' },
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  extraResources: [{ from: 'electron', to: 'owner-update-contract', filter: ['updateApproval.cjs', 'manualUpdater.cjs', 'windowsInstallerUpdate.cjs'] }],
  publish: null,
  win: { target: ['nsis'], artifactName: 'StudentOrganizerControlPanel-${version}-${arch}.${ext}' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.utilities', identity: null,
    artifactName: 'StudentOrganizerControlPanel-${version}-mac-${arch}.${ext}' }
};
