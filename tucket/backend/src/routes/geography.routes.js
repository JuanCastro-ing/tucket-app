/* Rutas de geografía: /api/geography/*
   Alimentan los tres selects encadenados (país → departamento → ciudad)
   del formulario de evento y del registro de clientes. */
const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/countries', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT code, name FROM countries ORDER BY name');
    res.json(result.rows);
  } catch (error) { next(error); }
});

router.get('/countries/:countryCode/departments', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT code, name FROM departments WHERE country_code = $1 ORDER BY name',
      [String(req.params.countryCode).toUpperCase()]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

router.get('/departments/:departmentCode/cities', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name FROM cities WHERE department_code = $1 ORDER BY name',
      [String(req.params.departmentCode).toUpperCase()]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

module.exports = router;
