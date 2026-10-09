import express from 'express'
import { handleConcierge } from './http.js'

export const conciergeRouter = express.Router()
conciergeRouter.use(express.json({ limit: '12kb', strict: true }))
conciergeRouter.use(async (req, res) => {
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join('; ') : v]),
  )
  const response = await handleConcierge({
    method: req.method,
    path: req.path,
    headers,
    body: req.body,
    ip: req.ip ?? 'unknown',
  })
  res.set(response.headers).status(response.statusCode).json(response.body)
})
