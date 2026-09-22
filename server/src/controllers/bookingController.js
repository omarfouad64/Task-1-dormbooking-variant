import Joi from 'joi';
import { Booking } from '../models/Booking.js';

const bookingFields = {
  roomNumber: Joi.string().trim().required(),
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().required(),
  purpose: Joi.string().trim().allow('').optional(),
  bookedBy: Joi.string().hex().length(24).optional()
};

const createSchema = Joi.object(bookingFields);

const updateSchema = Joi.object({
  roomNumber: bookingFields.roomNumber.optional(),
  startDate: bookingFields.startDate.optional(),
  endDate: bookingFields.endDate.optional(),
  purpose: bookingFields.purpose,
  bookedBy: bookingFields.bookedBy
}).min(1);

function validateDateRange(value) {
  const start = value.startDate ? new Date(value.startDate) : null;
  const end = value.endDate ? new Date(value.endDate) : null;

  if (start && end && start >= end) {
    return 'startDate must be strictly before endDate';
  }

  return null;
}

function withBookedBy(query) {
  return query.populate('bookedBy', 'name email');
}

async function findConflictingBooking({ roomNumber, startDate, endDate, excludeId }) {
  const query = {
    roomNumber,
    startDate: { $lt: endDate },
    endDate: { $gt: startDate }
  };

  if (excludeId) query._id = { $ne: excludeId };

  return Booking.findOne(query);
}

// GET /api/bookings
export async function getAllBookings(req, res, next) {
  try {
    const bookings = await withBookedBy(
      Booking.find().sort({ createdAt: -1 })
    ).lean();

    res.json({ bookings });
  } catch (err) { next(err); }
}

// GET /api/bookings/:id
export async function getBooking(req, res, next) {
  try {
    const booking = await withBookedBy(Booking.findById(req.params.id)).lean();
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    res.json({ booking });
  } catch (err) { next(err); }
}

// POST /api/bookings
export async function createBooking(req, res, next) {
  try {
    const { value, error } = createSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });

    const rangeError = validateDateRange(value);
    if (rangeError) return res.status(400).json({ message: rangeError });

    const conflict = await findConflictingBooking(value);
    if (conflict) {
      return res.status(409).json({ message: 'Booking conflicts with an existing booking for this room' });
    }

    const booking = await Booking.create(value);
    const populated = await withBookedBy(Booking.findById(booking._id)).lean();

    res.status(201).json({ booking: populated });
  } catch (err) { next(err); }
}

// PATCH /api/bookings/:id
export async function updateBooking(req, res, next) {
  try {
    const { value, error } = updateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });

    const existing = await Booking.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Booking not found' });

    const candidate = {
      roomNumber: value.roomNumber ?? existing.roomNumber,
      startDate: value.startDate ?? existing.startDate,
      endDate: value.endDate ?? existing.endDate
    };

    const rangeError = validateDateRange(candidate);
    if (rangeError) return res.status(400).json({ message: rangeError });

    const conflict = await findConflictingBooking({ ...candidate, excludeId: existing._id });
    if (conflict) {
      return res.status(409).json({ message: 'Booking conflicts with an existing booking for this room' });
    }

    const booking = await withBookedBy(
      Booking.findByIdAndUpdate(existing._id, { $set: value }, { new: true, runValidators: true })
    ).lean();

    res.json({ booking });
  } catch (err) { next(err); }
}

// DELETE /api/bookings/:id
export async function deleteBooking(req, res, next) {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    res.json({ ok: true });
  } catch (err) { next(err); }
}
