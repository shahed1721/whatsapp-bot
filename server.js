const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = './uploads/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); 

// 🔐 আপনার অ্যাডমিন প্যানেলের পাসওয়ার্ড:
const ADMIN_PASSWORD = "1234";

let currentQR = "";
let isConnected = false;

// 🔴 র‍্যাম বাঁচানোর জন্য Puppeteer-এ বিশেষ কোড যুক্ত করা হয়েছে
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--single-process'
        ]
    }
});

client.on('qr', async (qr) => {
    console.log('ওয়েবসাইটের জন্য নতুন QR কোড জেনারেট হচ্ছে...');
    currentQR = await qrcode.toDataURL(qr); 
});

client.on('ready', () => {
    console.log('✅ হোয়াটসঅ্যাপ সফলভাবে কানেক্ট হয়েছে!');
    isConnected = true;
    currentQR = "";
});

client.on('disconnected', async (reason) => {
    isConnected = false;
    currentQR = "";
    try { await client.destroy(); } catch(e) {}
    client.initialize(); 
});

client.initialize();

app.post('/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
    else res.json({ success: false, message: 'ভুল পাসওয়ার্ড!' });
});

app.post('/status', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ connected: isConnected, qr: currentQR });
});

app.post('/logout', async (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    try {
        try { await client.destroy(); } catch (e) {}
        const authFolder = path.join(__dirname, '.wwebjs_auth');
        if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
        isConnected = false; currentQR = "";
        client.initialize();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/get-files', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(401).send('Unauthorized');
    const dir = './uploads/';
    if (!fs.existsSync(dir)) return res.json({ images: [], csvs: [] });
    
    let files = fs.readdirSync(dir);
    files.sort((a, b) => fs.statSync(path.join(dir, b)).mtime.getTime() - fs.statSync(path.join(dir, a)).mtime.getTime());

    const images = files.filter(f => f.match(/\.(jpg|jpeg|png|gif|mp4)$/i));
    const csvs = files.filter(f => f.match(/\.(csv)$/i));
    
    res.json({ images, csvs });
});

app.post('/upload-file', upload.single('file'), (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(401).send('Unauthorized');
    if (req.file) {
        res.json({ success: true, filename: req.file.filename });
    } else {
        res.json({ success: false });
    }
});

const randomDelay = () => {
    const min = 5;
    const max = 15;
    const delayTime = Math.floor(Math.random() * (max - min + 1) + min) * 1000;
    return new Promise(resolve => setTimeout(resolve, delayTime));
};

app.post('/send', upload.single('media'), async (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(401).send('Unauthorized');

    const { phone, message, existingMedia } = req.body;
    const file = req.file;

    try {
        const formattedNumber = `${phone.replace(/\D/g, '')}@c.us`;
        let mediaPath = null;

        if (file) {
            mediaPath = file.path;
        } else if (existingMedia) {
            mediaPath = path.join(__dirname, 'uploads', path.basename(existingMedia));
        }

        await randomDelay();

        if (mediaPath && fs.existsSync(mediaPath)) {
            const media = MessageMedia.fromFilePath(mediaPath);
            await client.sendMessage(formattedNumber, media, { caption: message });
        } else {
            await client.sendMessage(formattedNumber, message);
        }
        res.status(200).send('Sent');
    } catch (error) {
        console.error('❌ মেসেজ পাঠানোর সময় এরর:', error);
        res.status(500).send('Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`সার্ভার চলছে। ব্রাউজারে যান: http://localhost:${PORT}`);
});
