/* Rutas de geografía: /api/geography/*
   Alimentan los tres selects encadenados (país → departamento → ciudad)
   del formulario de evento y del registro de clientes. */
const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/countries', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT codigo AS "code", nombre AS "name" FROM paises ORDER BY nombre');
    res.json(result.rows);
  } catch (error) { next(error); }
});

router.get('/countries/:countryCode/departments', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT codigo AS "code", nombre AS "name" FROM departamentos WHERE codigo_pais = $1 ORDER BY nombre',
      [String(req.params.countryCode).toUpperCase()]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

router.get('/departments/:departmentCode/cities', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre AS "name" FROM ciudades WHERE codigo_departamento = $1 ORDER BY nombre',
      [String(req.params.departmentCode).toUpperCase()]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

module.exports = router;
