// Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// Licensed under the Amazon Software License
// http://aws.amazon.com/asl/

/* eslint-disable  func-names */
/* eslint-disable  no-console */

const Alexa = require('ask-sdk-core');
const questions = require('./questions');
const info = require('./masInfo');
const i18n = require('i18next');
const sprintf = require('i18next-sprintf-postprocessor');

var persistenceAdapter = getPersistenceAdapter();

const ANSWER_COUNT = 5;
const GAME_LENGTH = 7;
const SKILL_NAME = 'Conociendo mis raices';
const FALLBACK_MESSAGE = 'Recuerda, en esta skill yo te hago preguntas y respondes con el número de tu respuesta. Dime repite para volver a preguntarte o puedes iniciar un juego nuevo. ¿Cómo te puedo ayudar?';
const FALLBACK_REPROMPT = '¿Cómo te puedo ayudar?';

const languageString = {
  es: { 
    translation: {
      QUESTIONS: questions.QUESTIONS_ES_MX,
      GAME_NAME: 'Conociendo mis raices',
      MENU_MESSAGE: 'Para iniciar la historia di Jugar. Para conocer más sobre la cultura Mexica di Más información. Para salir del Juego di Salir. ¿Que deseas hacer?',
      HELP_MESSAGE: 'Te haré %s preguntas de opción múltiple. Responde con el número de la respuesta. Para iniciar un juego nuevo di, comenzar juego. ¿Cómo te puedo ayudar?',
      REPEAT_QUESTION_MESSAGE: 'Para repetir la última pregunta dime: repíte',
      ASK_MESSAGE_START: 'Te gustaría comenzar a jugar?',
      HELP_REPROMPT: 'Para responder simplemente dime el número de tu respuesta',
      STOP_MESSAGE: '¿Quieres seguir jugando?',
      CANCEL_MESSAGE: 'Ok, jugaremos en otra ocasión',
      NO_MESSAGE: 'Ok, regresa pronto. ¡Adios!',
      TRIVIA_UNHANDLED: 'Intenta diciendo un número entre 1 y %s',
      HELP_UNHANDLED: 'Dime si para continuar, no para terminar el juego',
      START_UNHANDLED: 'Dime comenzar para iniciar el juego',
      NEW_GAME_MESSAGE: 'Bienvenido a %s. ',
      WELCOME_MESSAGE: 'Yo te haré %s preguntas, intenta adivinar la respuesta correcta diciendo el número de la respuesta, comencemos. ',
      ANSWER_CORRECT_MESSAGE: 'correcta. ',
      ANSWER_WRONG_MESSAGE: 'incorrecta. ',
      CORRECT_ANSWER_MESSAGE: 'La respuesta correcta es %s: %s. ',
      ANSWER_IS_MESSAGE: 'Esa respuesta es ',
      TELL_QUESTION_MESSAGE: 'Pregunta %s. %s ',
      GAME_OVER_MESSAGE: 'Has obtenido %s respuestas correctas de %s preguntas. ¡Gracias por jugar conmigo!',
      SCORE_IS_MESSAGE: 'Tu puntuación es %s. '
    },
  },
  'es-es': {
    translation: {
      QUESTIONS: questions.QUESTIONS_ES_ES,
      GAME_NAME: 'Conociendo mis raices en España',
      WELCOME_MESSAGE: 'Yo te haré %s preguntas sobre las capitales de estados mexicanos, intenta adivinar la respuesta correcta diciendo el número de la respuesta, comencemos. ',
    },
  },
};

function getPersistenceAdapter(tableName) {
  // This function is an indirect way to detect if this is part of an Alexa-Hosted skill
  function isAlexaHosted() {
      return process.env.S3_PERSISTENCE_BUCKET;
  }
  if (isAlexaHosted()) {
      const {S3PersistenceAdapter} = require('ask-sdk-s3-persistence-adapter');
      return new S3PersistenceAdapter({
          bucketName: process.env.S3_PERSISTENCE_BUCKET
      });
  } else {
      // IMPORTANT: don't forget to give DynamoDB access to the role you're using to run this lambda (via IAM policy)
      const {DynamoDbPersistenceAdapter} = require('ask-sdk-dynamodb-persistence-adapter');
      return new DynamoDbPersistenceAdapter({
          tableName: tableName || 'user_name',
          createTable: true
      });
  }
}

function populateGameQuestions(translatedQuestions) {
  const gameQuestions = [];
  const indexList = [];
  let index = translatedQuestions.length;
  if (GAME_LENGTH > index) {
    throw new Error('Longitud de Juego Inválida');
  }

  for (let i = 0; i < translatedQuestions.length; i += 1) {
    indexList.push(i);
  }

  for (let j = 0; j < GAME_LENGTH; j += 1) {
    const rand = Math.floor(Math.random() * index);
    index -= 1;

    const temp = indexList[index];
    indexList[index] = indexList[rand];
    indexList[rand] = temp;
    gameQuestions.push(indexList[index]);
  }
  return gameQuestions;
}

function populateRoundAnswers( gameQuestionIndexes, correctAnswerIndex, correctAnswerTargetLocation, translatedQuestions) {
  const answers = [];
  const translatedQuestion = translatedQuestions[gameQuestionIndexes[correctAnswerIndex]];
  const answersCopy = translatedQuestion[Object.keys(translatedQuestion)[0]].slice();
  let index = answersCopy.length;

  if (index < ANSWER_COUNT) {
    throw new Error('No hay suficiente respuestas para la pregunta');
  }

  // Shuffle the answers, excluding the first element which is the correct answer.
  for (let j = 1; j < answersCopy.length; j += 1) {
    const rand = Math.floor(Math.random() * (index - 1)) + 1;
    index -= 1;

    const swapTemp1 = answersCopy[index];
    answersCopy[index] = answersCopy[rand];
    answersCopy[rand] = swapTemp1;
  }

  // Swap the correct answer into the target location
  for (let i = 0; i < ANSWER_COUNT; i += 1) {
    answers[i] = answersCopy[i];
  }
  const swapTemp2 = answers[0];
  answers[0] = answers[correctAnswerTargetLocation];
  answers[correctAnswerTargetLocation] = swapTemp2;
  return answers;
}

function isAnswerSlotValid(intent) {
  const answerSlotFilled = intent
    && intent.slots
    && intent.slots.Answer
    && intent.slots.Answer.value;
  const answerSlotIsInt = answerSlotFilled
    && !Number.isNaN(parseInt(intent.slots.Answer.value, 10));
  return answerSlotIsInt
    && parseInt(intent.slots.Answer.value, 10) < (ANSWER_COUNT + 1)
    && parseInt(intent.slots.Answer.value, 10) > 0;
}

function handleUserGuess(userGaveUp, handlerInput) {
  const { requestEnvelope, attributesManager, responseBuilder } = handlerInput;
  const { intent } = requestEnvelope.request;

  const answerSlotValid = isAnswerSlotValid(intent);

  let speechOutput = '';
  let speechOutputAnalysis = '';

  const sessionAttributes = attributesManager.getSessionAttributes();
  const gameQuestions = sessionAttributes.questions;
  let correctAnswerIndex = parseInt(sessionAttributes.correctAnswerIndex, 10);
  let currentScore = parseInt(sessionAttributes.score, 10);
  let currentQuestionIndex = parseInt(sessionAttributes.currentQuestionIndex, 10);
  const { correctAnswerText } = sessionAttributes;
  const requestAttributes = attributesManager.getRequestAttributes();
  const translatedQuestions = requestAttributes.t('QUESTIONS');


  if (answerSlotValid
    && parseInt(intent.slots.Answer.value, 10) === sessionAttributes.correctAnswerIndex) {
    currentScore += 1;
    speechOutputAnalysis = requestAttributes.t('ANSWER_CORRECT_MESSAGE');
  } else {
    if (!userGaveUp) {
      speechOutputAnalysis = requestAttributes.t('ANSWER_WRONG_MESSAGE');
    }

    speechOutputAnalysis += requestAttributes.t(
      'CORRECT_ANSWER_MESSAGE',
      correctAnswerIndex,
      correctAnswerText
    );
  }

  // Check if we can exit the game session after GAME_LENGTH questions (zero-indexed)
  if (sessionAttributes.currentQuestionIndex === GAME_LENGTH - 1) {
    speechOutput = userGaveUp ? '' : requestAttributes.t('ANSWER_IS_MESSAGE');
    speechOutput += speechOutputAnalysis + requestAttributes.t(
      'GAME_OVER_MESSAGE',
      currentScore.toString(),
      GAME_LENGTH.toString()
    );

    return responseBuilder
      .speak(speechOutput)
    //agregar pantalla ganaste
      .getResponse();
  }
  currentQuestionIndex += 1;
  correctAnswerIndex = Math.floor(Math.random() * (ANSWER_COUNT));
  const spokenQuestion = Object.keys(translatedQuestions[gameQuestions[currentQuestionIndex]])[0];
  const roundAnswers = populateRoundAnswers(
    gameQuestions,
    currentQuestionIndex,
    correctAnswerIndex,
    translatedQuestions
  );
  const questionIndexForSpeech = currentQuestionIndex + 1;
  let repromptText = requestAttributes.t(
    'TELL_QUESTION_MESSAGE',
    questionIndexForSpeech.toString(),
    spokenQuestion
  );
  let answersScreen = "";
  for (let i = 0; i < ANSWER_COUNT; i += 1) {
    repromptText += `${i + 1}. ${roundAnswers[i]}. `;
    answersScreen += `${i + 1}. ${roundAnswers[i]} <br>`
  }
  

  speechOutput += userGaveUp ? '' : requestAttributes.t('ANSWER_IS_MESSAGE');
  speechOutput += speechOutputAnalysis
    + requestAttributes.t('SCORE_IS_MESSAGE', currentScore.toString())
    + repromptText;

  const translatedQuestion = translatedQuestions[gameQuestions[currentQuestionIndex]];

  Object.assign(sessionAttributes, {
    speechOutput: repromptText,
    repromptText,
    currentQuestionIndex,
    correctAnswerIndex: correctAnswerIndex + 1,
    questions: gameQuestions,
    score: currentScore,
    correctAnswerText: translatedQuestion[Object.keys(translatedQuestion)[0]][0],
    name: sessionAttributes['name']
  });

  return responseBuilder.speak(speechOutput)
    .reprompt(repromptText)
    .addDirective({
        type: 'Alexa.Presentation.APL.RenderDocument',
        version: '1.0',
        document: require('./questionAPL.json'),
        datasources: {
            "docdata": {
                "question": spokenQuestion,
                "answer": answersScreen
            }
        }
    })
    .getResponse();
}

function menuGame(newGame, handlerInput) {
  const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
  let speechText = newGame
    ? requestAttributes.t('NEW_GAME_MESSAGE', requestAttributes.t('GAME_NAME'))
      + requestAttributes.t('MENU_MESSAGE', GAME_LENGTH.toString())
    : '';

  return handlerInput.responseBuilder
  .speak(speechText)
  .withSimpleCard(requestAttributes.t('GAME_NAME'), speechText)
  .getResponse();
}

function requestName(handlerInput) {
   const AudioInicio = "<audio src='soundbank://soundlibrary/machines/power_up_down/power_up_down_10'/>"
  +"<audio src='soundbank://soundlibrary/explosions/electrical/electrical_04'/>"
  +"<audio src='soundbank://soundlibrary/water/nature/nature_10'/>"
  + "Hola viajero, soy alexa tu I <break time='100ms'/> A,"
  + "<break time='500ms'/>"
  + "<audio src='soundbank://soundlibrary/animals/amzn_sfx_bird_robin_chirp_1x_01'/>"
  + "me temo que el viaje en el tiempo no salio como esperamos, y terminamos varados en la antigua ciudad mexica "
  + "<break time='500ms'/>"
  + "<prosody volume='x-loud'>debo informarte que nos encontramos en un ambiente hostil, ya que estamos cerca de una civilización  Azteca.</prosody>"
  +  "<break time='500ms'/>"
  +  "<audio src='soundbank://soundlibrary/water/nature/nature_11'/>"
  + "<prosody pitch='x-low'>Tengo fallas en mis sistemas de circuitos,</prosody><break time='500ms'/>";
  
   return handlerInput.responseBuilder
      .speak(AudioInicio)
      .reprompt(AudioInicio)
      .addDelegateDirective({
          name: 'RegisterNameIntent',
          confirmationStatus: 'NONE',
          slots: {}
      })
        .getResponse();
}

const RegisterNameIntentHandler = {
  canHandle(handlerInput) {
      return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
          && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RegisterNameIntent';
  },
  handle(handlerInput) {
    // the attributes manager allows us to access session attributes
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const {attributesManager, requestEnvelope, responseBuilder} = handlerInput;
    const sessionAttributes = attributesManager.getSessionAttributes();
    
    const name = Alexa.getSlotValue(requestEnvelope, 'name');
    
    sessionAttributes['name'] = name;
    const speechText = "Cierto " + name + " como lo pude olvidar!"
  +"<break time='500ms'/>"
  + "<audio src='soundbank://soundlibrary/footsteps/wood/wood_05'/>"
  + "<voice name='Enrique'><prosody pitch='high'><prosody volume='x-loud'>TLEN TEHUATL?, Ihuān teh, ¿quen motōcā?, ¿icniuhtli?, ¿marica? </prosody></prosody></voice>"
  + "<break time='1s'/>"
  + "¡Vaya parece que es Tezcatlipoca!, el gran sacerdote, quiere saber quien eres y si eres amigo <break time='500ms'/> o <break time='500ms'/> enemigo<break time='500ms'/>"
  + "<amazon:effect name='whispered'> creo que no nos conviene ser enemigo, no les va muy bien, o eso tengo en mis registros </amazon:effect>"
  + "<break time='500ms'/>"
  + "Entonces, ¿qué le digo que eres?" 
    
    ;
    
    return responseBuilder
      .speak(speechText)
      .withSimpleCard(requestAttributes.t('speechText'), speechText)
      .getResponse(); 
  }
};  

const FriendIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'FriendIntent';
  },
  handle(handlerInput) {
    // the attributes manager allows us to access session attributes
    return startGame(true, handlerInput);
  }
}

const GameIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'GameIntent';
  },
  handle(handlerInput) {
    return requestName(handlerInput);    
  },
};

const MoreInfoIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'MoreInfoIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speechText = info.intro;

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard(requestAttributes.t('GAME_NAME'), speechText)
      .getResponse();
  },
};

const ContinueMoreInfoIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'ContinueMoreInfoIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speechText = info.conclusion;

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard(requestAttributes.t('GAME_NAME'), speechText)
      .getResponse();
  },
};

const MenuIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'MenuIntent';
  },
  handle(handlerInput) {

    return menuGame(true, handlerInput);
  },
};

function startGame(newGame, handlerInput) {
  const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
  const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
  const name = sessionAttributes['name'];
  let speechOutput = newGame
    ? requestAttributes.t(' <voice name="Enrique"><prosody pitch="high"><prosody volume="x-loud">nepatlalistli tekipanoa yoli tlania tetlamolistli tlatlani temachyotl tlauaualoni tetlajtolana melauak tlatlani makuili xomotl chikome immanyotl tetlapolotia olinmitl ka chachamekatli</prosody></prosody></voice>') 
      + requestAttributes.t('<break time="1s"/> Dice que no confia en nosotros pero por ahora ser amigo bastara para mantenerte vivo, <break time="1s"/> nos hara unas pruebas para determinar si somos de confianza o no.')
      + requestAttributes.t('<prosody volume="loud"> Las reglas para sobrevivir es contestar correctamente 5 preguntas y conseguir 5 Xomotl,<break time="1s"/> tendremos 7 oportunidades<prosody volume="x-loud"> al final<break time="1s"/> se te hara un juicio.</prosody> </prosody>')
      + requestAttributes.t('<break time="1s"/> ¿Recuerdas la cultura Azteca cierto?.<break time="1s"/> Para poder continuar mejor, yo traducire ahora en adelante. ¿Estas Listo %s?', name)
    : '';
  const translatedQuestions = requestAttributes.t('QUESTIONS');
  const gameQuestions = populateGameQuestions(translatedQuestions);
  const correctAnswerIndex = Math.floor(Math.random() * (ANSWER_COUNT));

  const roundAnswers = populateRoundAnswers(
    gameQuestions,
    0,
    correctAnswerIndex,
    translatedQuestions
  );
  const currentQuestionIndex = 0;
  const spokenQuestion = Object.keys(translatedQuestions[gameQuestions[currentQuestionIndex]])[0];
  let repromptText = requestAttributes.t('TELL_QUESTION_MESSAGE', '1', spokenQuestion);
  let answersScreen = "";
  for (let i = 0; i < ANSWER_COUNT; i += 1) {
    repromptText += `${i + 1}. ${roundAnswers[i]}. `;
    answersScreen += `${i + 1}. ${roundAnswers[i]} <br>`
  }

  const _sessionAttributes = {};
  speechOutput += repromptText;

  const translatedQuestion = translatedQuestions[gameQuestions[currentQuestionIndex]];

  Object.assign(_sessionAttributes, {
    speechOutput: repromptText,
    repromptText,
    currentQuestionIndex,
    correctAnswerIndex: correctAnswerIndex + 1,
    questions: gameQuestions,
    score: 0,
    correctAnswerText: translatedQuestion[Object.keys(translatedQuestion)[0]][0],
    name: name
  });

  handlerInput.attributesManager.setSessionAttributes(_sessionAttributes);

  return handlerInput.responseBuilder
    .speak(speechOutput)
    .reprompt(repromptText)
    .withSimpleCard(requestAttributes.t('GAME_NAME'), repromptText)
    .addDirective({
        type: 'Alexa.Presentation.APL.RenderDocument',
        version: '1.0',
            document: require('./questionAPL.json'),
        datasources: {
            "docdata": {
                "question": spokenQuestion,
                "answer": answersScreen
            }
        }
    })
    .getResponse();
}

function helpTheUser(newGame, handlerInput) {
  const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
  const askMessage = newGame
    ? requestAttributes.t('ASK_MESSAGE_START')
    : requestAttributes.t('REPEAT_QUESTION_MESSAGE') + requestAttributes.t('STOP_MESSAGE');
  const speechOutput = requestAttributes.t('HELP_MESSAGE', GAME_LENGTH) + askMessage;
  const repromptText = requestAttributes.t('HELP_REPROMPT') + askMessage;

  return handlerInput.responseBuilder.speak(speechOutput).reprompt(repromptText).getResponse();
}

const LocalizationInterceptor = {
  process(handlerInput) {
    const localizationClient = i18n.use(sprintf).init({
      lng: handlerInput.requestEnvelope.request.locale,
      overloadTranslationOptionHandler: sprintf.overloadTranslationOptionHandler,
      resources: languageString,
      returnObjects: true
    });

    const attributes = handlerInput.attributesManager.getRequestAttributes();
    attributes.t = function (...args) {
      return localizationClient.t(...args);
    };
  },
};

const LaunchRequest = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return request.type === 'LaunchRequest'
      || (request.type === 'IntentRequest'
        && request.intent.name === 'AMAZON.StartOverIntent');
  },
  handle(handlerInput) {
    return menuGame(true, handlerInput);
  },
};


const HelpIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

    const newGame = !(sessionAttributes.questions);
    return helpTheUser(newGame, handlerInput);
  },
};

const FallbackHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'IntentRequest'
      && request.intent.name === 'SimulateFallBackIntent';
  },

  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(FALLBACK_MESSAGE)
      .reprompt(FALLBACK_REPROMPT)
      .getResponse();
  },
};

const UnhandledIntent = {
  canHandle() {
    return true;
  },
  handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    if (Object.keys(sessionAttributes).length === 0) {
      const speechOutput = requestAttributes.t('START_UNHANDLED');
      return handlerInput.attributesManager
        .speak(speechOutput)
        .reprompt(speechOutput)
        .getResponse();
    } else if (sessionAttributes.questions) {
      const speechOutput = requestAttributes.t('TRIVIA_UNHANDLED', ANSWER_COUNT.toString());
      return handlerInput.responseBuilder
        .speak(speechOutput)
        .reprompt(speechOutput)
        .getResponse();
    }
    const speechOutput = requestAttributes.t('HELP_UNHANDLED');
    return handlerInput.responseBuilder.speak(speechOutput).reprompt(speechOutput).getResponse();
  },
};

const SessionEndedRequest = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`La sesión se ha finalizado con la razón: ${handlerInput.requestEnvelope.request.reason}`);

    return handlerInput.responseBuilder.getResponse();
  },
};

const AnswerIntent = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
        && (handlerInput.requestEnvelope.request.intent.name === 'AnswerIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'DontKnowIntent');
  },
  handle(handlerInput) {
    if (handlerInput.requestEnvelope.request.intent.name === 'AnswerIntent') {
      return handleUserGuess(false, handlerInput);
    }
    return handleUserGuess(true, handlerInput);
  },
};

const RepeatIntent = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
        && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.RepeatIntent';
  },
  handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    return handlerInput.responseBuilder.speak(sessionAttributes.speechOutput)
      .reprompt(sessionAttributes.repromptText)
      .getResponse();
  },
};

const YesIntent = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
        && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.YesIntent';
  },
  handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    if (sessionAttributes.questions) {
      return handlerInput.responseBuilder.speak(sessionAttributes.speechOutput)
        .reprompt(sessionAttributes.repromptText)
        .getResponse();
    }
    return startGame(false, handlerInput);
  },
};


const StopIntent = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
        && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speechOutput = requestAttributes.t('STOP_MESSAGE');

    return handlerInput.responseBuilder.speak(speechOutput)
      .reprompt(speechOutput)
      .getResponse();
  },
};

const CancelIntent = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speechOutput = requestAttributes.t('CANCEL_MESSAGE');

    return handlerInput.responseBuilder.speak(speechOutput)
      .getResponse();
  },
};

const NoIntent = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NoIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speechOutput = requestAttributes.t('NO_MESSAGE');
    return handlerInput.responseBuilder.speak(speechOutput).getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error: ${error.message}`);

    return handlerInput.responseBuilder
      .speak('Lo siento, no puedo entender el comando. Por favor, intenta de nuevo.')
      .reprompt('Lo siento, no puedo entender el comando. Por favor, intenta de nuevo.')
      .getResponse();
  },
};

const LoadAttributesRequestInterceptor = {
  async process(handlerInput) {
      const {attributesManager, requestEnvelope} = handlerInput;
      if (Alexa.isNewSession(requestEnvelope)){ //is this a new session? this check is not enough if using auto-delegate (more on next module)
          const persistentAttributes = await attributesManager.getPersistentAttributes() || {};
          console.log('Loading from persistent storage: ' + JSON.stringify(persistentAttributes));
          //copy persistent attribute to session attributes
          attributesManager.setSessionAttributes(persistentAttributes); // ALL persistent attributtes are now session attributes
      }
  }
};

// If you disable the skill and reenable it the userId might change and you loose the persistent attributes saved below as userId is the primary key
const SaveAttributesResponseInterceptor = {
  async process(handlerInput, response) {
      if (!response) return; // avoid intercepting calls that have no outgoing response due to errors
      const {attributesManager, requestEnvelope} = handlerInput;
      const sessionAttributes = attributesManager.getSessionAttributes();
      const shouldEndSession = (typeof response.shouldEndSession === "undefined" ? true : response.shouldEndSession); //is this a session end?
      if (shouldEndSession || Alexa.getRequestType(requestEnvelope) === 'SessionEndedRequest') { // skill was stopped or timed out
          // we increment a persistent session counter here
          sessionAttributes['sessionCounter'] = sessionAttributes['sessionCounter'] ? sessionAttributes['sessionCounter'] + 1 : 1;
          // we make ALL session attributes persistent
          console.log('Saving to persistent storage:' + JSON.stringify(sessionAttributes));
          attributesManager.setPersistentAttributes(sessionAttributes);
          await attributesManager.savePersistentAttributes();
      }
  }
};

const skillBuilder = Alexa.SkillBuilders.custom();
exports.handler = skillBuilder
  .addRequestHandlers(
    LaunchRequest,
    HelpIntent,
    AnswerIntent,
    RepeatIntent,
    YesIntent,
    StopIntent,
    CancelIntent,
    NoIntent,
    SessionEndedRequest,
    FallbackHandler,
    GameIntentHandler,
    MoreInfoIntentHandler,
    RegisterNameIntentHandler,
    FriendIntentHandler,
    ContinueMoreInfoIntentHandler,
    MenuIntentHandler,
    UnhandledIntent
  )
  .addRequestInterceptors(
    LocalizationInterceptor,
    LoadAttributesRequestInterceptor)
  .addResponseInterceptors(
      SaveAttributesResponseInterceptor)
  .withPersistenceAdapter(persistenceAdapter)
  .addErrorHandlers(ErrorHandler)
  .lambda();