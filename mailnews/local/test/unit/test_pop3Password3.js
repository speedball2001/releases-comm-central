/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/**
 * Extra tests for POP3 passwords (forgetPassword)
 */

ChromeUtils.import("resource:///modules/MailServices.jsm");
ChromeUtils.import("resource://gre/modules/Services.jsm");

load("../../../resources/passwordStorage.js");

var kUser1 = "testpop3";
var kUser2 = "testpop3a";
var kProtocol = "pop3";
var kHostname = "localhost";
var kServerUrl = "mailbox://" + kHostname;

add_task(async function () {
  // Prepare files for passwords (generated by a script in bug 1018624).
  await setupForPassword("signons-mailnews1.8-multiple.json");

  // Set up the basic accounts and folders.
  // We would use createPop3ServerAndLocalFolders() however we want to have
  // a different username and NO password for this test (as we expect to load
  // it from the signons json file in which the login information is stored).
  localAccountUtils.loadLocalMailAccount();

  let incomingServer1 = MailServices.accounts.createIncomingServer(kUser1, kHostname,
                                                                   kProtocol);

  let incomingServer2 = MailServices.accounts.createIncomingServer(kUser2, kHostname,
                                                                   kProtocol);

  var count = {};

  // Test - Check there are two logins to begin with.
  var logins = Services.logins.findLogins(count, kServerUrl, null, kServerUrl);

  Assert.equal(count.value, 2);
  Assert.equal(logins.length, 2);

  // These will either be one way around or the other.
  if (logins[0].username == kUser1) {
    Assert.equal(logins[1].username, kUser2);
  } else {
    Assert.equal(logins[0].username, kUser2);
    Assert.equal(logins[1].username, kUser1);
  }

  // Test - Remove a login via the incoming server
  incomingServer1.forgetPassword();

  logins = Services.logins.findLogins(count, kServerUrl, null, kServerUrl);

  // should be one login left for kUser2
  Assert.equal(count.value, 1);
  Assert.equal(logins[0].username, kUser2);

  // Bug 561056 - Expand username to also contain domain (i.e. full email).
  incomingServer2.realUsername = kUser2 + "@local.host";

  logins = Services.logins.findLogins(count, kServerUrl, null, kServerUrl);

  // There should still be the one login left for kUser2
  Assert.equal(count.value, 1);
  Assert.equal(logins[0].username, kUser2);

  // Change username to another one.
  incomingServer2.realUsername = "testpop";

  logins = Services.logins.findLogins(count, kServerUrl, null, kServerUrl);

  // There should be no login left.
  Assert.equal(count.value, 0);
  Assert.equal(logins.length, 0);
});

function run_test() {
  run_next_test();
}
