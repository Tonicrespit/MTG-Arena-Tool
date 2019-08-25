const { app } = require("electron");
const path = require("path");
const fs = require("fs");
var http = require("https");

const manifestParser = require("./manifest-parser");
const { generateMetadata } = require("./metadata-generator");
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

const {
  APPDATA,
  RANKS_SHEETS,
  SETS_DATA,
  NO_DUPES_ART_SETS,
  ALLOWED_SCRYFALL
} = require("./metadata-constants");

let metagameData = {};
let ranksData = {};

app.on("ready", () => {
  console.log("Begin Metadata fetch.");
  // It would be nice if we could suppy the version manually or
  // obtain it from somewhere automatically, like a settings
  // file or the output log itself.
  //getScryfallCards().then(quit);

  manifestParser
    .getManifestFiles("1622.721726")
    //.then(getRanksData)
    //.then(getScryfallCards)
    .then(generateScryfallDatabase)
    .then(data => generateMetadata(data))
    //.then(getMetagameData)
    .then(quit);
});

app.on("closed", function() {
  console.log("closed");
});

function quit() {
  console.log("Goodbye!");
  app.quit();
}

function getRanksData() {
  let requests = RANKS_SHEETS.map(rank => {
    return new Promise(resolve => {
      console.log(`Get ${rank.setCode.toUpperCase()} ranks data.`);
      httpGetFile(
        `https://docs.google.com/spreadsheets/d/${
          rank.sheet
        }/gviz/tq?headers=2&range=B1:B,F1:F,G1:G&sheet=${rank.page}`,
        rank.setCode + "_ranks"
      ).then(file => {
        fs.readFile(file, function read(err, data) {
          let str = data.toString();
          str = str
            .replace("/*O_o*/", "")
            .replace(`google.visualization.Query.setResponse(`, "")
            .replace(`);`, " ");

          console.log(`${rank.setCode.toUpperCase()} ok.`);
          try {
            ranksData[rank.setCode] = JSON.parse(str);
          } catch (e) {
            console.log(e);
          }
        });

        resolve();
      });
    });
  });

  return Promise.all(requests);
}

function getMetagameData() {
  return new Promise(resolve => {
    let req = httpGetText("https://mtgatool.com/database/metagame.php");
    console.log("Download metagame data.");
    req.addEventListener("load", function() {
      let json = JSON.parse(`{"metagame": ${req.responseText} }`);
      metagameData = json.metagame;
      resolve();
    });
  });
}

const SCRYFALL_FILE = "scryfall-default-cards.json";

function getScryfallCards() {
  return new Promise(resolve => {
    let file = path.join(APPDATA, "external", SCRYFALL_FILE);
    if (!fs.existsSync(file)) {
      console.log("Downloading Scryfall cards data.");
      httpGetFile(
        "https://archive.scryfall.com/json/" + SCRYFALL_FILE,
        SCRYFALL_FILE
      ).then(file => {
        resolve();
      });
    } else {
      console.log("Skipping Scryfall cards data download.");
      resolve();
    }
  });
}

function generateScryfallDatabase() {
  return new Promise(resolve => {
    console.log("Processing Scryfall database.");
    let file = path.join(APPDATA, "external", SCRYFALL_FILE);

    fs.stat(file, function(err, stats) {
      var fileSize = stats.size;
      var readSize = 0;
      var stream = fs.createReadStream(file, { flags: "r", encoding: "utf-8" });
      var buf = "";

      let scryfallData = {};

      let pump = function() {
        var pos;

        while ((pos = buf.indexOf("\n")) >= 0) {
          // keep going while there's a newline somewhere in the buffer
          if (pos == 0) {
            // if there's more than one newline in a row, the buffer will now start with a newline
            buf = buf.slice(1); // discard it
            continue; // so that the next iteration will start with data
          }
          processLine(buf.slice(0, pos)); // hand off the line
          buf = buf.slice(pos + 1); // and slice the processed data off the buffer
        }
      };

      let processLine = function(line) {
        // here's where we do something with a line

        if (line[line.length - 1] == "\r")
          line = line.substr(0, line.length - 1); // discard CR (0x0D)

        line = line.slice(0, -1);

        if (line.length > 0) {
          try {
            var obj = JSON.parse(line);
            if (ALLOWED_SCRYFALL.includes(obj.set)) {
              let lang = obj.lang.toUpperCase();

              if (scryfallData[lang] == undefined) scryfallData[lang] = {};
              if (scryfallData[lang][obj.set] == undefined)
                scryfallData[lang][obj.set] = {};
              if (scryfallData[lang][obj.set][obj.name] == undefined)
                scryfallData[lang][obj.set][obj.name] = {};

              if (NO_DUPES_ART_SETS.includes(obj.set)) {
                scryfallData[lang][obj.set][obj.name] = obj;
              } else {
                scryfallData[lang][obj.set][obj.name][
                  obj.collector_number
                ] = obj;
              }
            }
          } catch (e) {
            //console.log(e);
          }
        }
      };

      stream.on("data", function(d) {
        var dataLength = d.length;
        readSize += dataLength;
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(
          `Progress:\t ${((readSize / fileSize) * 100).toFixed(2)}%`
        );

        buf += d.toString(); // when data is read, stash it in a string buffer
        pump(); // then process the buffer
      });

      stream.on("end", function() {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(`Progress:\t ${(100).toFixed(2)}%`);
        console.log("");
        resolve(scryfallData);
      });
    });
  });
}

function httpGetText(url) {
  let xmlHttp = new XMLHttpRequest();
  xmlHttp.open("GET", url);
  xmlHttp.send();
  return xmlHttp;
}

function httpGetFile(url, file) {
  return new Promise(resolve => {
    file = path.join(APPDATA, "external", file);

    let dir = path.join(APPDATA, "external");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    let stream = fs.createWriteStream(file);
    http.get(url, response => {
      response.pipe(stream);
      response.on("end", function() {
        resolve(file);
      });
    });
  });
}
