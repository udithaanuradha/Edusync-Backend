 const express = require('express');
const cors = require('cors');
require('dotenv').config();

// If this line fails, your folder 'routes' or file 'authRoutes.js' is missing/misspelled
const authRoutes = require('./routes/authRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
    res.send('EduSync Server is Live!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});