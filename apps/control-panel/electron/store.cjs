const path = require('node:path');
const { app } = require('electron');
module.exports = require(path.join(app.isPackaged ? path.join(process.resourcesPath, 'owner-update-contract') : path.join(__dirname, '../../../electron'), 'controlPanelStore.cjs'));
