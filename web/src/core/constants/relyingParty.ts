export const relyingParty = {
  name:
    process.env.NODE_ENV === 'development' ? 'RAYRIFFY' : 'みのり',
  id:
    process.env.NODE_ENV === 'development'
      ? 'localhost'
      : 'minori.rayriffy.com',
}
