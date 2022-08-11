import cookie from 'cookie'
import { nanoid } from 'nanoid'
import { PrismaClient } from '@prisma/client'

import { encodeBase64 } from '../../core/services/encodeBase64'
import { setSession } from '../../core/services/session/set'
import { sessionCookieName } from '../../core/constants/sessionCookieName'
import { maxSessionAge } from '../../core/constants/maxSessionAge'
import { completeAuthenticatorChallenge } from '../../modules/register/services/completeAuthenticatorChallenge'
import { createAuthenticatorChallenge } from '../../modules/register/services/createAuthenticatorChallenge'
import { relyingParty } from '../../core/constants/relyingParty'

import type { RequestHandler } from '@sveltejs/kit'
import type { RegisterRequest } from '../../core/@types/api/RegisterRequest'

// pre-generate challenge, and user ids
export const GET: RequestHandler = async event => {
  const username = event.url.searchParams.get('username')

  // if no username is provided, then dead
  if (username === null) {
    return {
      status: 400,
      body: {
        message: 'no username provided',
      },
    }
  }

  // check if there're any existing records for this username
  const prisma = new PrismaClient()
  const user = await prisma.user.findFirst({
    where: {
      username: username.toLowerCase(),
    },
  })

  // if user already completed registration, then dead
  if (user?.registered) {
    return {
      status: 400,
      body: {
        message: 'username has already been taken',
      },
    }
  }

  const generatedUserId = user?.uid ?? nanoid()

  // if user not found then create a new one
  if (user === null) {
    await prisma.user.create({
      data: {
        uid: generatedUserId,
        username: username.toLowerCase(),
      },
    })
  }
  
  const challenge = await createAuthenticatorChallenge(prisma, generatedUserId)

  // terminate connection
  await prisma.$disconnect()
  return {
    status: 200,
    body: {
      message: 'ok',
      data: {
        rp: relyingParty,
        uid: encodeBase64(Buffer.from(generatedUserId)),
        challenge: challenge,
      },
    },
  }
}

// verify challenge result, and register user if success
export const POST: RequestHandler = async event => {
  const request: RegisterRequest = await event.request.json()

  const prisma = new PrismaClient()

  try {
    const completedChallenge = await completeAuthenticatorChallenge(
      prisma,
      request.response.clientDataJSON,
      request.response.attestationObject
    )

    // allow user to be registered
    await prisma.user.update({
      where: {
        uid: completedChallenge.uid,
      },
      data: {
        registered: true,
      },
    })
    await prisma.$disconnect()

    // issue user token
    const authenticatedToken = await setSession({
      id: completedChallenge.uid,
      username: completedChallenge.username,
    })

    return {
      status: 200,
      headers: {
        'Set-Cookie': cookie.serialize(sessionCookieName, authenticatedToken, {
          path: '/',
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.NODE_ENV === 'production',
          maxAge: maxSessionAge,
        }),
      },
      body: {
        message: 'ok',
      },
    }
  } catch (e) {
    let errorMessage: string = (e as any).message
    switch (errorMessage) {
      case 'challenge-failed':
        errorMessage = 'challenge response does not match'
        break
    }

    return {
      status: 400,
      body: {
        message: errorMessage
      }
    }
  }
}
