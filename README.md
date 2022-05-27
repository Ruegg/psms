# PSMS

PSMS is a server that connects to your GSM Modem through the serialport-gsm module, and uses RSA-4096 and AES-256 over a socket connection to allow any PSMS Clients to securely and remotely read/send SMS.

In my case, I'm using a Raspberry Pi 4B with a WaveShare GSM HAT with the SIM800C. Paired with a 10$ unlimited text plan, I can now send/receive SMS securely from any of my other projects without being subject to pay-per-text SMS API services. In addition, many other services block numbers used by SMS API services, and this project supports any SIM allowing personal numbers unlikely to be blocked.

## Installation

```
git clone https://github.com/Ruegg/psms
npm install
npm run start
```

There are a few constant variables that can be changed such as the passphrase for clients, number being used, message persistence, etc. If you're using your home network, you must port forward on the configured port in order for any PSMS Clients to be able to access the server.

## How it works

PSMS on startup will generate an RSA key pair and save it to the same directory as `public.pem` and `private.pem`. PSMS Clients must be configured with the `public.pem` as well as the hardcoded passphrase in the PSMS server in order to authenticate properly.

Upon any PSMS Client connecting, the client sends over a symmetric key from AES and the passphrase in a packet encrypted using the PSMS public key. Only the server can decrypt this info, and at this point both the PSMS and PSMS client share a symmetric key that will be used for further communication.

Setting up any PSMS Client is easy, and can be seen at [the repo](https://github.com/Ruegg/psms-client).
