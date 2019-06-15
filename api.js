/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "skeleton" }]*/
/* global ExtensionAPI */
ChromeUtils.defineModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
ChromeUtils.defineModuleGetter(this, "AddonManager", "resource://gre/modules/AddonManager.jsm");

const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");

async function fix(desiredFile, extension) {
  let storageJSON = Services.logins.wrappedJSObject._storage.wrappedJSObject;
  storageJSON.terminate();
  try {
    await storageJSON._store.finalize();
  } catch (ex) {
    // May be already finalized
    Cu.reportError(ex);
  }

  let loginsJSONPath = OS.Path.join(OS.Constants.Path.profileDir, "logins.json");
  let recoveryBackupPath = OS.Path.join(OS.Constants.Path.profileDir, "logins.json.before-recovery");
  if (await OS.File.exists(loginsJSONPath)) {
    await OS.File.move(loginsJSONPath, recoveryBackupPath);
  }

  console.log("restoring", desiredFile);
  await OS.File.copy(desiredFile, loginsJSONPath);
  await uninstall(extension.id);
  Services.startup.quit(Ci.nsIAppStartup.eRestart | Ci.nsIAppStartup.eAttemptQuit);
}

async function getCorruptFiles() {
  let iterator = new OS.File.DirectoryIterator(OS.Constants.Path.profileDir);
  let files = [];
  try {
    for await (let entry of iterator) {
      if (!entry.name.startsWith("logins.json") || !entry.name.includes(".corrupt")) {
        continue;
      }
      let stats = await OS.File.stat(entry.path);
      let file = {
        entry,
        stats,
      };
      file.modificationDate = stats.lastModificationDate;
      files.push(file);
    }

  } finally {
    iterator.close();
  }

  return files.sort(function compare(a, b) {
    return a.modificationDate - b.modificationDate;
  });
}

async function uninstall(extensionID) {
  console.log("uninstalling");
  let addon = await AddonManager.getAddonByID(extensionID);
  addon.uninstall();
}

this.skeleton = class extends ExtensionAPI {
  async onStartup() {
    let corrupt = await getCorruptFiles();
    console.log("onStartup", corrupt);

    let dialogTitle = "Restore a backup of Firefox logins";

    if (!corrupt.length) {
      Services.prompt.alert(null, dialogTitle, "Firefox could not find any backup login files.");
      await uninstall(this.extension.id);
      return;
    }

    if (corrupt.length == 1) {
      let message = `Click “OK” to restart Firefox and restore your logins from backup.`;
      let ok = Services.prompt.confirm(null, dialogTitle, message);
      if (!ok) {
        await uninstall(this.extension.id);
        return;
      }

      await fix(corrupt[0].entry.path, this.extension);
      return;
    }

    // Otherwise dialog to choose from more than one.
    const MS_IN_DAY = 86400000;
    let rtf1 = new Intl.RelativeTimeFormat(undefined, { style: 'narrow', numeric: 'auto' });
    let now = Date.now();
    let labels = corrupt.map(file => {
      let msDiff = file.modificationDate - now;
      let days = Math.ceil(msDiff / MS_IN_DAY);
      return `${file.entry.name} / ${file.stats.size}B / ${rtf1.format(days, "day")}`;
    });

    let dialogText  = `Choose the backup logins file to restore. Clicking “OK” will restart Firefox.`;

    let selectedIndex = { value: null };

    // If user selects ok, outparam.value is set to the index
    // of the selected file entry.
    let ok = Services.prompt.select(null,
                                    dialogTitle, dialogText,
                                    labels.length, labels,
                                    selectedIndex);

    if (!ok) {
      await uninstall(this.extension.id);
      return;
    }

    let selectedFile = corrupt[selectedIndex.value];
    await fix(selectedFile.entry.path, this.extension);
  }
};
