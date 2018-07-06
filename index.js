window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
 
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;

window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

const bsNs = "bs_ns_";

async function run() {
var db;
if (!window.indexedDB) {
    console.error("Your browser doesn't support a stable version of IndexedDB, no persistence");
} else {
  db = await getDb();
}

var defaultAnnounce = ["udp://explodie.org:6969", "udp://tracker.coppersurfer.tk:6969", "udp://tracker.empire-js.us:1337", "udp://tracker.leechers-paradise.org:6969", "udp://tracker.opentrackr.org:1337", "wss://tracker.btorrent.xyz", "wss://tracker.fastcast.nz", "wss://tracker.openwebtorrent.com"];

var shaarch = decodeURI(window.location.search.substring(1));
var magnet;
var sep = shaarch.indexOf('&');

if (sep > 0) {
  magnet = shaarch.substring(sep+1);
  shaarch = shaarch.substring(0,sep);
}

var lastHash = await readVal(db,'','lastHash');
if (shaarch.length != 64) {
  shaarch = lastHash;
}

var unsafe = await readVal(db,'','unsafe');

if (!shaarch || shaarch.length != 64) {
  console.error("Invalid sha256, syntax is ? + sha256 as 64 char hex string + (not mandatory) & + encodeURI(magnetlink) ");
} else {
  window.bootSite = {
    'unsafe' : unsafe
  };
  console.log("bootstrapping from : " + magnet);
  console.log("with sha256 : " + shaarch);
  console.log("torrent will be store in window.bootSite.torr");
  var client = new WebTorrent();
  client.on('error', function (err) {
    console.error('ERROR: ' + err.message)
  });

  var blobSite = await blobFromStorage(db,shaarch);
  // if no magnet link check in local storage for hash (+ hash chek) file and recreate the link
  if (magnet == null) {
    magnet = await magnetFromStorage(db,shaarch);
  }

  if (blobSite == null) {
    // download from magnet
    var torr = await new Promise((resolve,reject) => client.add(magnet,resolve));
    window.bootSite.torr = torr;
    await torrPromise(torr);
    var blob = await getFirstFile(torr);
    var ok = await check_sha256(blob,shaarch);
    if (ok) {
      // rem await to run in paralell??
      await blobInStorage(db,shaarch,blob,magnet,torr.announce,torr.name);
      loadSite(blob,db,lastHash,shaarch);
    } else {
      console.error("wrong hash from torrent, do not load");
    }
  } else {
    var trackers = await trackersFromStorage(db, shaarch);
    var torr = await new Promise((resolve,reject) => client.seed(new Blob([blobSite]),{
      announce : trackers.trackers,
      name : trackers.name
    }, resolve));

    console.log("start seeding site from storage");
    window.bootSite.torr = torr;
    loadSite(await getFirstFile(torr),db,lastHash,shaarch);
  }


}
}

run();

async function blobFromStorage(db, hash) {
  var blob = await readVal(db,hash,'file');
  //var blob = window.localStorage.getItem(hash);
  if (blob != null) {
    if (await check_sha256(blob,hash)) {
      return blob;
    }
   
  }
  return null;
}

async function trackersFromStorage(db,hash) {
  var tracks = await readVal(db,hash,'trackers');
  return tracks;
//  var tracks = window.localStorage.getItem('trackers' + hash);
/*  if (tracks != null) {
    return tracks.split(',');
  } else {
    return defaultAnnounce;
  }*/
//  return [];
}

async function magnetFromStorage(db,hash) {
  var magnet = await readVal(db,hash,'magnet');
  return magnet;
//  return window.localStorage.getItem('magnet' + hash);
}

async function blobInStorage(db,hash,blob,magnet,trackers,name) {
  var dec = new TextDecoder();
  await writeVal(db,hash,'file',blob);
  await writeVal(db,hash,'magnet',magnet);
  await writeVal(db,hash,'trackers',{trackers : trackers, name : name});
//  window.localStorage.setItem(hash,blob);
//  window.localStorage.setItem('magnet' + hash,magnet);
//  window.localStorage.setItem('trackers' + hash,trackers);
}

async function loadSite(blob,db,lastHash,shaarch) {
  console.log("LOAD SITE");
  // extract blob and load site
  var zip = new JSZip();
  var zipFiles = await zip.loadAsync(blob);
  var unzipBootBlobs = {};
  window.bootSite.unzipBootBlobs = unzipBootBlobs;
  if (!window.bootSite.unsafe) {
    window.bootSite.ffscripttoeval = {};
  }
  var indexHtml;
  for (var n in zipFiles.files) {
    var file = zipFiles.files[n];
    if (!file.dir) {
      var b = await file.async('blob');
      // only rep index.html
      if (file.name === 'index.html') {
        var fr = new FileReader();
        var frp = frPromise(fr);
        fr.readAsText(b);
        await frp;
        indexHtml = fr.result;
      } else if (file.name.endsWith('.js') && !window.bootSite.unsafe) {
        var fr = new FileReader();
        var frp = frPromise(fr);
        fr.readAsText(b);
        await frp;
        window.bootSite.ffscripttoeval[file.name] = fr.result;
      } else {
        var url = URL.createObjectURL(b);
        b.url = url;
        unzipBootBlobs[file.name] = url;
      }
    }
  }
  for (var n in unzipBootBlobs) {
    // warning should regexp to target src and href attribute only
    // should also replace if prefixed with site url
    indexHtml = indexHtml.replace(n,unzipBootBlobs[n]);
  }
  window.bootSite.indexBootBlob = indexHtml;
  // switch envt
  await SwitchEnvt(db,lastHash, shaarch);
  // refresh hook
  window.bootSite.refresh = function() {

    ReplaceContent(indexHtml);
  };
  window.bootSite.setUnsafe = function (b) {
    getDb().then(function(db2) {
      writeVal(db2,'','unsafe',b);
    });
  }

  ReplaceContent(indexHtml);
}

async function check_sha256(blob,target) {
  if (crypto.subtle.digest == null) {
    console.error("non native sha 256");
    return false;
  }
  var hash = await crypto.subtle.digest('sha-256',blob);
  return buf2hex(hash) === target;
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

function getFirstFile(torr) {
  return new Promise(function(resolve,reject) {
    torr.files[0].getBuffer(function(error,res) {
      if (error != null) {
        reject(error);
      } else {
        resolve(res);
      }
    });
  });
}

function getDb() {
  return new Promise(function(resolve,reject) {
  var request = window.indexedDB.open("boot_site_db", 1);
 
  request.onerror = function(event) {
    console.log("error: ");
    reject(event);
  };
  request.onupgradeneeded = function(event) {
    var db = request.result;
    if (!db.objectStoreNames.contains('default')) {
      db.createObjectStore('default');
    }
  };
  request.onsuccess = function(event) {
    var db = request.result;
    console.log("success: "+ db);
    resolve(db);
  };
  });
}

function readVal(db,hash,key) {
  return new Promise(function(resolve,reject) {
  var transaction = db.transaction(['default']);
  var objectStore = transaction.objectStore('default');
  var request = objectStore.get(key + hash);
  request.onerror = function(event) {
    console.log("Unable to retrieve data from database!");
    reject(event);
  };
  request.onsuccess = function(event) {
    resolve(request.result);
  };
  });
}

function writeVal(db,hash,key,val) {
  return new Promise(function(resolve,reject) {
  var request = db.transaction(['default'], "readwrite")
    .objectStore('default')
    .put(val,key + hash);
                                 
  request.onsuccess = function(event) {
    resolve(event);
  };

  request.onerror = function(event) {
    console.error("error writing in indexeddb" + event);
    reject(event);
  }

  });
}
 
function torrPromise(torr) {
  return new Promise(function(resolve,reject) {
     torr.on('done',resolve);
     torr.on('error',reject);
  });
}

function frPromise(fr) {
  return new Promise(function(resolve,reject) {
    fr.onerror = reject;
    fr.onload = resolve;
  });
}

async function SwitchEnvt(db,lastHash, newHash) {
  if (lastHash !== newHash) {
    await saveEnvt(db,lastHash);
    await loadEnvt(db,newHash);
  } else {
    // only load newHash context
    await loadEnvt(db,newHash);
  }
}
async function saveEnvt(db,hash) {
  var toRem = [];
  // localstorage
  for (var i = 0; i < localStorage.length; i++){
    var key = localStorage.key(i);
    if (!key.startsWith(bsNs)) {
      localStorage.setItem(bsNs+hash+key,localStorage.getItem(key));
      toRem.push(key);
    }
  }
  for (var key of toRem) {
    localStorage.removeItem(key);
  }
  // same thing for indexed db seems to costy (inhability to rename db)
}
async function loadEnvt(db,hash) {
  var toRem = [];
  var prefix = bsNs+hash;
  for (var i = 0; i < localStorage.length; i++){
    var key = localStorage.key(i);
    if (key.startsWith(prefix)) {
      localStorage.setItem(key.substring(prefix.length),localStorage.getItem(key));
      toRem.push(key);
    }
  }

  for (var key of toRem) {
    localStorage.removeItem(key);
  }

//        bsNs
  await writeVal(db,'','lastHash',hash);
}
function ReplaceContent(NC) {
  let curr = window.location.pathname + window.location.search;
  // allow back after refresh failure
  window.history.pushState({},"boot",curr);
  // replace hosting to location only
  window.history.replaceState({},"new",window.location.origin);
  if (!window.bootSite.unsafe) {
    // TODO regexp it or at least allow uppercase
    var start = window.bootSite.indexBootBlob.indexOf("<head>") + 6; 
    var end = window.bootSite.indexBootBlob.indexOf("</head>");
    document.head.innerHTML = window.bootSite.indexBootBlob.substring(start,end);
    start = window.bootSite.indexBootBlob.indexOf("<body>") + 6; 
    end = window.bootSite.indexBootBlob.indexOf("</body>");
    document.body.innerHTML = window.bootSite.indexBootBlob.substring(start,end);

    // eval all new script tag (modernjs)
    document.querySelectorAll('script').forEach((s)=> {
      var s = window.bootSite.ffscripttoeval[s.getAttribute('src')];
      if (s != null) {
        eval(s);
      }
    });
  } else {
    document.open();
    document.write(NC);
    document.close();
  }
}

function isFirefox() {
 return navigator.userAgent.search("Firefox") > 0;
}
/*
 *{
  announce: [String],        // Torrent trackers to use (added to list in .torrent or magnet uri)
  getAnnounceOpts: Function, // Custom callback to allow sending extra parameters to the tracker
  maxWebConns: Number,       // Max number of simultaneous connections per web seed [default=4]
  path: String,              // Folder to download files to (default=`/tmp/webtorrent/`)
  store: Function            // Custom chunk store (must follow [abstract-chunk-store](https://www.npmjs.com/package/abstract-chunk-store) API)
}

client.on('torrent',cb
client.on('error',cb
torrent.infoHash
torrent.magnetURI
torrent.torrentFileBlobURL
torrent.torrentFile : Uint8Array
torrent.on('error'
torrent.on('done'
*/

