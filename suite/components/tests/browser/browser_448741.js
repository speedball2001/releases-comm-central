/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function test() {
  /** Test for Bug 448741 **/

  waitForExplicitFinish();

  let uniqueName = "bug 448741";
  let uniqueValue = "as good as unique: " + Date.now();

  // set a unique value on a new, blank tab
  var tab = getBrowser().addTab();
  tab.linkedBrowser.stop();
  ss.setTabValue(tab, uniqueName, uniqueValue);
  let valueWasCleaned = false;

  // prevent our value from being written to disk
  function cleaningObserver(aSubject, aTopic, aData) {
    ok(aTopic == "sessionstore-state-write", "observed correct topic?");
    ok(aSubject instanceof Ci.nsISupportsString, "subject is a string?");
    ok(aSubject.data.includes(uniqueValue), "data contains our value?");

    // find the data for the newly added tab and delete it
    let state = JSON.parse(aSubject.data);
    state.windows.forEach(function (winData) {
      winData.tabs.forEach(function (tabData) {
        if (tabData.extData && uniqueName in tabData.extData &&
            tabData.extData[uniqueName] == uniqueValue) {
          delete tabData.extData[uniqueName];
          valueWasCleaned = true;
        }
      });
    });

    ok(valueWasCleaned, "found and removed the specific tab value");
    aSubject.data = JSON.stringify(state);
    Services.obs.removeObserver(cleaningObserver, aTopic, false);
  }

  // make sure that all later observers don't see that value any longer
  function checkingObserver(aSubject, aTopic, aData) {
    ok(valueWasCleaned && aSubject instanceof Ci.nsISupportsString,
       "ready to check the cleaned state?");
    ok(!aSubject.data.includes(uniqueValue), "data no longer contains our value?");

    // clean up
    getBrowser().removeTab(tab);
    Services.obs.removeObserver(checkingObserver, aTopic, false);
    if (Services.prefs.prefHasUserValue("browser.sessionstore.interval"))
      Services.prefs.clearUserPref("browser.sessionstore.interval");
    finish();
  }

  // last added observers are invoked first
  Services.obs.addObserver(checkingObserver, "sessionstore-state-write");
  Services.obs.addObserver(cleaningObserver, "sessionstore-state-write");

  // trigger an immediate save operation
  Services.prefs.setIntPref("browser.sessionstore.interval", 0);
}
