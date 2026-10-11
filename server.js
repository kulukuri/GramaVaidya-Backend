require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors()); 
app.use(express.json()); 

const JWT_SECRET = process.env.JWT_SECRET || "gramahealth_super_secret_key";

// ✅ Correctly importing the route using require
const triageRoutes = require('./routes/triageRoutes');
app.use('/api', triageRoutes);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Database'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// --- DATABASE MODELS ---

const doctorSchema = new mongoose.Schema({
  name: String, specialty: String, hospital: String, location: String,
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  status: { type: String, default: 'Available' },
  tokens: { type: Number, default: 0 },
  completedTokens: { type: Number, default: 0 } // NEW: Tracks finished patients
});
const Doctor = mongoose.model('Doctor', doctorSchema);

const patientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  mobile: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  location: String
});
const Patient = mongoose.model('Patient', patientSchema);

const appointmentSchema = new mongoose.Schema({
  patientName: String, patientMobile: String, age: Number, symptoms: String,
  doctorId: mongoose.Schema.Types.ObjectId, doctorName: String, hospital: String, 
  tokenNumber: Number,
  status: { type: String, default: 'Pending' }, // NEW: Pending or Completed
  createdAt: { type: Date, default: Date.now }
});
const Appointment = mongoose.model('Appointment', appointmentSchema);

// --- SECURITY MIDDLEWARE ---
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization');
  if (!token) return res.status(401).json({ error: "Access denied. No token provided." });
  try {
    req.user = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch (err) {
    res.status(400).json({ error: "Invalid token." });
  }
};

// --- API ROUTES ---

app.get('/api/doctors', async (req, res) => {
  try { res.json(await Doctor.find().select('-password')); } 
  catch (err) { res.status(500).json({ error: "Failed to fetch doctors" }); }
});

app.post('/api/doctors/register', async (req, res) => {
  try {
    const { name, specialty, hospital, location, email, password } = req.body;
    if (await Doctor.findOne({ email })) return res.status(400).json({ error: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newDoctor = new Doctor({ name, specialty, hospital, location, email, password: hashedPassword });
    await newDoctor.save();

    const token = jwt.sign({ _id: newDoctor._id }, JWT_SECRET, { expiresIn: '1d' });
    newDoctor.password = undefined; 
    res.status(201).json({ token, doctor: newDoctor });
  } catch (err) { res.status(500).json({ error: "Failed to register doctor" }); }
});

app.post('/api/doctors/login', async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ email: req.body.email });
    if (!doctor || !(await bcrypt.compare(req.body.password, doctor.password))) {
      return res.status(400).json({ error: "Invalid email or password" });
    }
    const token = jwt.sign({ _id: doctor._id }, JWT_SECRET, { expiresIn: '1d' });
    doctor.password = undefined;
    res.json({ token, doctor });
  } catch (err) { res.status(500).json({ error: "Failed to login" }); }
});

app.put('/api/doctors/:id/status', verifyToken, async (req, res) => {
  try { res.json(await Doctor.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }).select('-password')); } 
  catch (err) { res.status(500).json({ error: "Failed to update status" }); }
});

app.post('/api/patients/register', async (req, res) => {
  try {
    const { name, mobile, password, location } = req.body;
    if (await Patient.findOne({ mobile })) return res.status(400).json({ error: "Mobile number already registered" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newPatient = new Patient({ name, mobile, password: hashedPassword, location });
    await newPatient.save();
    const token = jwt.sign({ _id: newPatient._id, role: 'patient' }, JWT_SECRET, { expiresIn: '7d' });
    newPatient.password = undefined;
    res.status(201).json({ token, patient: newPatient });
  } catch (err) { res.status(500).json({ error: "Failed to register patient" }); }
});

app.post('/api/patients/login', async (req, res) => {
  try {
    const { name, mobile, password } = req.body;
    const patient = await Patient.findOne({ mobile });
    if (!patient || patient.name !== name || !(await bcrypt.compare(password, patient.password))) {
      return res.status(400).json({ error: "Invalid Name, Mobile, or Password" });
    }
    const token = jwt.sign({ _id: patient._id, role: 'patient' }, JWT_SECRET, { expiresIn: '7d' });
    patient.password = undefined;
    res.json({ token, patient });
  } catch (err) { res.status(500).json({ error: "Failed to login" }); }
});

app.post('/api/appointments/book', verifyToken, async (req, res) => {
  try {
    const { patientName, patientMobile, age, symptoms, doctorId, doctorName, hospital } = req.body;
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    // 1. Increment doctor's total tokens
    doctor.tokens += 1;
    await doctor.save();

    // 2. Save the new appointment
    const newAppointment = new Appointment({
      patientName, patientMobile, age, symptoms, doctorId, doctorName, hospital, tokenNumber: doctor.tokens
    });
    await newAppointment.save();

    // --- NEW: IMMEDIATE SMS LOGIC FOR SHORT QUEUES ---
    const completed = doctor.completedTokens || 0;
    const peopleAhead = doctor.tokens - completed - 1; // Calculate exactly like the frontend

    // If there are less than 3 people ahead of them, send the SMS immediately!
    if (peopleAhead < 3) {
        console.log(`🚀 Queue is short (${peopleAhead} people ahead). Sending immediate SMS to Token #${newAppointment.tokenNumber}...`);
        
        // (Make sure this is your correct n8n Test URL)
        const N8N_WEBHOOK_URL = "http://localhost:5678/webhook/19551823-af97-4976-9da1-f0c121c1076d";
        
        const realPatientData = {
          patientName: newAppointment.patientName,         
          patientMobile: newAppointment.patientMobile, 
          tokenNumber: newAppointment.tokenNumber,         
          hospital: newAppointment.hospital || "GramaVaidya Clinic" 
        };
        
        fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(realPatientData)
        })
        .then(() => console.log("✅ Successfully pinged n8n Webhook on Booking!"))
        .catch(err => console.error("❌ Failed to ping n8n:", err));
    }
    // --- END OF IMMEDIATE SMS LOGIC ---

    res.status(201).json(newAppointment);
  } catch (err) { res.status(500).json({ error: "Failed to book appointment" }); }
});

app.get('/api/appointments/patient/:mobile', verifyToken, async (req, res) => {
  try { res.json(await Appointment.find({ patientMobile: req.params.mobile }).sort({ createdAt: -1 })); } 
  catch (err) { res.status(500).json({ error: "Failed to fetch patient history" }); }
});
// --- FETCH DOCTOR'S PENDING PATIENTS ---
app.get('/api/appointments/doctor/:doctorId', verifyToken, async (req, res) => {
  try {
    // Fetch only 'Pending' appointments for this doctor, sorted by token number
    const appointments = await Appointment.find({ 
        doctorId: req.params.doctorId, 
        status: 'Pending' 
    }).sort({ tokenNumber: 1 });
    
    res.json(appointments);
  } catch (err) { 
    res.status(500).json({ error: "Failed to fetch doctor's queue" }); 
  }
});
// --- MARK APPOINTMENT AS COMPLETED & NOTIFY NEXT PATIENT ---
app.put('/api/appointments/:id/complete', verifyToken, async (req, res) => {
  console.log("🔥 DOCTOR CLICKED MARK COMPLETED!");
  try {
    // 1. Find the current patient and mark them completed
    const currentAppt = await Appointment.findById(req.params.id);
    if (!currentAppt || currentAppt.status === 'Completed') return res.status(400).json({ error: "Already completed" });
    
    currentAppt.status = 'Completed';
    await currentAppt.save();
    await Doctor.findByIdAndUpdate(currentAppt.doctorId, { $inc: { completedTokens: 1 } });

    // 2. Calculate who to notify (e.g., if token 2 is done, notify token 5)
    const notificationThreshold = 3; 
    const tokenToNotify = currentAppt.tokenNumber + notificationThreshold;

    // 3. Search the database for that specific upcoming patient
    const upcomingPatient = await Appointment.findOne({
        doctorId: currentAppt.doctorId,
        tokenNumber: tokenToNotify,
        status: 'Pending'
    });

    // 4. If that patient exists, send THEIR data to n8n!
    if (upcomingPatient) {
        console.log(`📡 Found upcoming patient: ${upcomingPatient.patientName} (Token ${tokenToNotify}). Sending SMS...`);
        
        const N8N_WEBHOOK_URL = "http://localhost:5678/webhook-test/19551823-af97-4976-9da1-f0c121c1076d";
        
        const realPatientData = {
          patientName: upcomingPatient.patientName,         
          patientMobile: upcomingPatient.patientMobile, 
          tokenNumber: upcomingPatient.tokenNumber,         
          hospital: upcomingPatient.hospital || "GramaVaidya Clinic" 
        };
        
        fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(realPatientData)
        })
        .then(() => console.log("✅ Successfully pinged n8n Webhook for upcoming patient!"))
        .catch(err => console.error("❌ Failed to ping n8n:", err));
    } else {
        console.log(`ℹ️ No patient found waiting for Token #${tokenToNotify}. No SMS sent.`);
    }

    res.json(currentAppt);
  } catch (err) { res.status(500).json({ error: "Failed to update appointment" }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Fully Secure Backend Server running on http://localhost:${PORT}`));
