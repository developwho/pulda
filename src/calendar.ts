export function calendarContent(date: string, time: string, reminder: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error('INVALID_DATE')
  const start = new Date(`${date}T${time}:00+09:00`)
  if (!Number.isFinite(start.getTime())) throw new Error('INVALID_DATE')
  if (
    new Date(start.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) !== `${date}T${time}`
  )
    throw new Error('INVALID_DATE')
  const stamp = (value: Date) =>
    value
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pulda//Visit//KO',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@pulda`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    'SUMMARY:방문 일정',
    'DESCRIPTION:내가 확인하고 추가한 일정이에요.',
    ...(reminder
      ? [
          'BEGIN:VALARM',
          'TRIGGER:-PT1H',
          'ACTION:DISPLAY',
          'DESCRIPTION:방문 일정이 있어요.',
          'END:VALARM',
        ]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}
export function downloadCalendar(date: string, time: string, reminder: boolean) {
  const url = URL.createObjectURL(
    new Blob([calendarContent(date, time, reminder)], { type: 'text/calendar;charset=utf-8' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'pulda-visit.ics'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
