/* Tests internal URIs generated by various methods in the code base.
 * If you manually generate a news URI somewhere, please add it to this test.
 */

load("../../../resources/logHelper.js");
load("../../../resources/asyncTestUtils.js");
load("../../../resources/alertTestUtils.js");

ChromeUtils.import("resource:///modules/MailServices.jsm");
ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

var dummyMsgWindow = {
  get statusFeedback() {
    return {
      startMeteors: function () {},
      stopMeteors: function () {
        async_driver();
      },
      showProgress: function () {}
    };
  },
  get promptDialog() {
    return alertUtilsPrompts;
  },
  QueryInterface: ChromeUtils.generateQI([Ci.nsIMsgWindow,
                                          Ci.nsISupportsWeakReference])
};
var daemon, localserver, server;

var tests = [
  test_newMsgs,
  test_cancel,
  test_fetchMessage,
  test_search,
  test_grouplist,
  test_postMessage,
  test_escapedName,
  cleanUp
];

var kCancelArticle =
  "From: fake@acme.invalid\n"+
  "Newsgroups: test.filter\n"+
  "Subject: cancel <4@regular.invalid>\n"+
  "References: <4@regular.invalid>\n"+
  "Control: cancel <4@regular.invalid>\n"+
  "MIME-Version: 1.0\n"+
  "Content-Type: text/plain\n"+
  "\n"+
  "This message was cancelled from within ";

function* test_newMsgs() {
  // This tests nsMsgNewsFolder::GetNewsMessages via getNewMessages
  let folder = localserver.rootFolder.getChildNamed("test.filter");
  Assert.equal(folder.getTotalMessages(false), 0);
  folder.getNewMessages(null, asyncUrlListener);
  yield false;
  Assert.equal(folder.getTotalMessages(false), 8);
  yield true;
}

// Prompts for cancel
function alert(title, text) {}
function confirmEx(title, text, flags) {  return 0; }

function* test_cancel() {
  // This tests nsMsgNewsFolder::CancelMessage
  let folder = localserver.rootFolder.getChildNamed("test.filter");
  let db = folder.msgDatabase;
  let hdr = db.GetMsgHdrForKey(4);

  let folderListener = {
    OnItemEvent: function(aEventFolder, aEvent) {
      if (aEvent == "DeleteOrMoveMsgCompleted") {
        MailServices.mailSession.RemoveFolderListener(this);
      }
    }
  };
  MailServices.mailSession.AddFolderListener(folderListener, Ci.nsIFolderListener.event);
  folder.QueryInterface(Ci.nsIMsgNewsFolder)
        .cancelMessage(hdr, dummyMsgWindow);
  yield false;

  Assert.equal(folder.getTotalMessages(false), 7);

  // Check the content of the CancelMessage itself.
  let article = daemon.getGroup("test.filter")[9];
  // Since the cancel message includes the brand name (Daily, Thunderbird), we
  // only check the beginning of the string.
  Assert.ok(article.fullText.startsWith(kCancelArticle));
  yield true;
}

function* test_fetchMessage() {
  // Tests nsNntpService::CreateMessageIDURL via FetchMessage
  var statuscode = -1;
  let streamlistener = {
    onDataAvailable: function() {},
    onStartRequest: function() {
    },
    onStopRequest: function (aRequest, aContext, aStatus) {
      statuscode = aStatus;
    },
    QueryInterface: ChromeUtils.generateQI([Ci.nsIStreamListener,
                                            Ci.nsIRequestObserver])
  };
  let folder = localserver.rootFolder.getChildNamed("test.filter");
  MailServices.nntp.fetchMessage(folder, 2, null, streamlistener, asyncUrlListener);
  yield false;
  Assert.equal(statuscode, Cr.NS_OK);
  yield true;
}

function* test_search() {
  // This tests nsNntpService::Search
  let folder = localserver.rootFolder.getChildNamed("test.filter");
  var searchSession = Cc["@mozilla.org/messenger/searchSession;1"]
                        .createInstance(Ci.nsIMsgSearchSession);
  searchSession.addScopeTerm(Ci.nsMsgSearchScope.news, folder);

  let searchTerm = searchSession.createTerm();
  searchTerm.attrib = Ci.nsMsgSearchAttrib.Subject;
  let value = searchTerm.value;
  value.str = 'First';
  searchTerm.value = value;
  searchTerm.op = Ci.nsMsgSearchOp.Contains;
  searchTerm.booleanAnd = false;
  searchSession.appendTerm(searchTerm);

  let hitCount;
  let searchListener = {
    onSearchHit: function (dbHdr, folder) { hitCount++; },
    onSearchDone: function (status) {
      searchSession.unregisterListener(this);
      async_driver();
    },
    onNewSearch: function() { hitCount = 0; }
  };
  searchSession.registerListener(searchListener);

  searchSession.search(null);
  yield false;

  Assert.equal(hitCount, 1);
  yield true;
}

function* test_grouplist() {
  // This tests nsNntpService::GetListOfGroupsOnServer
  let subserver = localserver.QueryInterface(Ci.nsISubscribableServer);
  let subscribeListener = {
    OnDonePopulating: function () { async_driver(); }
  };
  subserver.subscribeListener = subscribeListener;

  function enumGroups(rootUri) {
    let hierarchy = subserver.getChildren(rootUri);
    let groups = [];
    while (hierarchy.hasMoreElements()) {
      let element = hierarchy.getNext().QueryInterface(Ci.nsIRDFResource);
      let name = element.ValueUTF8;
      name = name.slice(name.lastIndexOf("/") + 1);
      if (subserver.isSubscribable(name))
        groups.push(name);
      if (subserver.hasChildren(name))
        groups = groups.concat(enumGroups(name));
    }
    return groups;
  }

  MailServices.nntp.getListOfGroupsOnServer(localserver, null, false);
  yield false;

  let groups = enumGroups("");
  for (let group in daemon._groups)
    Assert.ok(groups.indexOf(group) >= 0);

  // Release reference, somehow impedes GC of 'subserver'.
  subserver.subscribeListener = null;
  yield true;
}

function* test_postMessage() {
  // This tests nsNntpService::SetUpNntpUrlForPosting via PostMessage
  MailServices.nntp.postMessage(do_get_file("postings/post2.eml"), "misc.test",
    localserver.key, asyncUrlListener, null);
  yield false;
  Assert.equal(daemon.getGroup("misc.test").keys.length, 1);
  yield true;
}

// Not tested because it requires UI, and this is insufficient, I think.
function test_forwardInline() {
  // This tests mime_parse_stream_complete via forwarding inline
  let folder = localserver.rootFolder.getChildNamed("test.filter");
  let hdr = folder.msgDatabase.GetMsgHdrForKey(1);
  MailServices.compose.forwardMessage("a@b.invalid", hdr, null,
    localserver, Ci.nsIMsgComposeService.kForwardInline);
}

function* test_escapedName() {
  // This does a few tests to make sure our internal URIs work for newsgroups
  // with names that need escaping
  let evilName = "test.malformed&name";
  daemon.addGroup(evilName);
  daemon.addArticle(make_article(do_get_file("postings/bug670935.eml")));
  localserver.subscribeToNewsgroup(evilName);

  // Can we access it?
  let folder = localserver.rootFolder.getChildNamed(evilName);
  folder.getNewMessages(null, asyncUrlListener);
  yield false;

  // If we get here, we didn't crash--newsgroups unescape properly.
  // Load a message, to test news-message: URI unescaping
  var statuscode = -1;
  let streamlistener = {
    onDataAvailable: function() {},
    onStartRequest: function() {
    },
    onStopRequest: function (aRequest, aContext, aStatus) {
      statuscode = aStatus;
    },
    QueryInterface: ChromeUtils.generateQI([Ci.nsIStreamListener,
                                            Ci.nsIRequestObserver])
  };
  MailServices.nntp.fetchMessage(folder, 1, null, streamlistener, asyncUrlListener);
  yield false;
  Assert.equal(statuscode, Cr.NS_OK);
  yield true;
}

function run_test() {
  daemon = setupNNTPDaemon();
  server = makeServer(NNTP_RFC2980_handler, daemon);
  server.start();
  localserver = setupLocalServer(server.port);

  // Set up an identity for posting
  let identity = MailServices.accounts.createIdentity();
  identity.fullName = "Normal Person";
  identity.email = "fake@acme.invalid";
  MailServices.accounts.FindAccountForServer(localserver).addIdentity(identity);

  async_run_tests(tests);
}

function cleanUp() {
  localserver.closeCachedConnections();
}
