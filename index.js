const serialportgsm = require('serialport-gsm');
const fs = require('fs');
const { generateKeyPair, privateDecrypt, constants, createDecipheriv, createCipheriv, randomBytes } = require('crypto');

const PASSPHRASE = "SomeSecurePhrase";
const PORT = 8080;
const OWN_NUMBER = "1323XXXXXXX";
const PERSIST_TEXTS = true;

const options = {
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    rtscts: false,
    xon: false,
    xoff: false,
    xany: false,
    autoDeleteOnReceive: false,
    enableConcatenation: true,
    incomingCallIndication: false,
    incomingSMSIndication: true,
    cnmiCommand: 'AT+CNMI=2,1,2,1,0'
};

const modem = serialportgsm.Modem();

const WebSocketServer = require('ws').Server;
const wss = new WebSocketServer({
  port: PORT
});

var messages = [];
var privateKey = null;

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    if(ws.isAuthenticated){
      let parsed = JSON.parse(data);
      let iv = parsed.iv;
      let decipher = createDecipheriv('aes-256-cbc', ws.safe.aesKey, Buffer.from(iv, 'base64'));
      let decrypted = decipher.update(parsed.encrypted, 'base64')
      decrypted += decipher.final('utf8');

      let parsedDecrypted = JSON.parse(decrypted);
      handleEvent(ws, parsedDecrypted.name, parsedDecrypted.data);
    }else{
      const decrypted = privateDecrypt({
        key: privateKey,
        padding: constants.RSA_PKCS1_PADDING
      }, data);

      const parsed = JSON.parse(decrypted);
      if(typeof parsed.passphrase != "string"){
        ws.close();
        return;
      }
      if(parsed.passphrase != PASSPHRASE){
        ws.close();
        return;
      }

      console.log("A new client has been authenticated.");
      ws.isAuthenticated = true;
      ws.safe = {};
      if(typeof parsed.aesKey == "string"){
        ws.safe.aesKey = Buffer.from(parsed.aesKey, 'base64');
      }
    }
  });

  setTimeout(() => {
    if(!ws.isAuthenticated){
      console.log("Closing stalling client.");
      ws.close();
    }
  }, 5000);
});

function sendEncrypted(ws, data){
  let aesIV = randomBytes(16);
  let cipher = createCipheriv('aes-256-cbc', ws.safe.aesKey, aesIV);
  let encryptedData = cipher.update(data, "utf8", "base64");
  encryptedData += cipher.final("base64");

  let obj = {iv: aesIV.toString('base64'), encrypted: encryptedData};
  let stringified = JSON.stringify(obj);
  ws.send(stringified);
}

function init(){
  //Key generation
  if(!fs.existsSync('./private.pem')){
    console.log("Creating RSA keypair...");
    generateKeyPair('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    }, (err, publicKey, privateKey) => {
      if(err){
        console.log("Error generating RSA key.");
      }

      fs.writeFileSync('./private.pem', privateKey);
      fs.writeFileSync('./public.pem', publicKey);

      privateKey = privateKey;
      console.log("Generated RSA keypair.");
    });
  }else{
    console.log("Loading key...");
    privateKey = fs.readFileSync('./private.pem');
    console.log("Loaded key.");
  }
  //Modem handling
  initModem();

  console.log("Loading messages...");
  loadMessages();

  console.log("Waiting for connections...");
}

function initModem(){
  console.log("Opening modem...");

  modem.open('/dev/ttyS0', options).then(() => {});

  modem.on('open', data => {
    console.log("Modem opened");

    modem.initializeModem((initResult) => {
      console.log("Initalized modem!");

      modem.setModemMode((result) => {
        modem.setOwnNumber(OWN_NUMBER, () => {

          modem.on('onNewMessage', messageDetails => {

            let sender = messageDetails.sender;
            let message = messageDetails.message;
            let timeSent = messageDetails.dateTimeSent;

            //Store message
            messages.push([sender, message, timeSent]);
            if(PERSIST_TEXTS){
              saveMessages();
            }

            //Alert clients
            emitAll("RECEIVED_SMS", messageDetails);

            //Delete off SIM
            modem.deleteMessage(messageDetails, (res) => {});
          });
        });
      }, 'PDU');
    });
  });
}

function handleEvent(ws, eventName, data){
  console.log("Received " + eventName + " event");
  if(eventName == "SEND_SMS"){
    let phoneNumber = data.phoneNumber;
    let content = data.content;

    console.log("Sending SMS('" + content + "' => " + phoneNumber + ")...");
    modem.sendSMS(phoneNumber, content, false, (data) => {
      console.log("SMS Sent.");
    });
  }else if(eventName == "GET_MESSAGES"){
    let limit = data.limit;
    let recentMessages = messages.slice((-1*limit));
    console.log("Sending stored messages.");
    sendEncrypted(ws, JSON.stringify({name: "MESSAGES", data: {limit: limit, messages: recentMessages}}));
  }
}

function emitAll(eventName, data){
  wss.clients.forEach(function each(ws) {
    if (ws.isAuthenticated) {
      sendEncrypted(ws, JSON.stringify({name: "RECEIVED_SMS", data: data}));
    }
  });
}

function loadMessages(){
  if(fs.existsSync("./messages.json")){
    messages = JSON.parse(fs.readFileSync("./messages.json"));
  }
}

function saveMessages(){
  fs.writeFileSync("./messages.json", JSON.stringify(messages));
}

init();
