import * as botpress from '.botpress'
import axios from 'axios'
import { CalendlyData, WebhookSubscriptionData, WebhookSubscription } from './const'

type IntegrationLogger = botpress.Client['client']['logger']

export const getCurrentUserAPICall = async (accessToken: string, logger: IntegrationLogger) => {
  let organizationID = ''
  let userID = ''

  const getUserOptions = {
    method: 'GET',
    url: 'https://api.calendly.com/users/me',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  }

  try {
    // Make the request and wait for the response
    const response = await axios.request(getUserOptions)

    // Extract organizationID and userID from the response
    organizationID = response.data.resource.current_organization
    userID = response.data.resource.uri

  } catch (error) {
    logger.forBot().error('Error getting current user:', JSON.stringify(error))
    return { organizationID, userID }
  }

  return { organizationID, userID }
}

export const getEventTypesAPICall = async (userID: string, accessToken: string, logger: IntegrationLogger) => {

  const getEventOptions = {
    method: 'GET',
    url: 'https://api.calendly.com/event_types',
    params: {
      active: 'true',
      user: userID,
      count: '20'
    },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  }

  try {
    // Make the request and wait for the response
    const response = await axios.request(getEventOptions)
    return response.data

  } catch (error) {
    // Log the error
    logger.forBot().error('Error getting event types:', JSON.stringify(error))
    return null
  }
}

export function findEventTypeUriBySchedulingUrl(data: CalendlyData, schedulingUrl: string) {

  for (let eventType of data.collection) {
    if (eventType.scheduling_url === schedulingUrl) {
      return eventType.uri
    }
  }
  return ''
}

export async function getWebhookSubscriptionsAPICall(organizationID: string, userID: string, accessToken: string, logger: IntegrationLogger) {

  let webhooks = {} as WebhookSubscriptionData

  const options = {
    method: 'GET',
    url: 'https://api.calendly.com/webhook_subscriptions',
    params: {
      organization: organizationID,
      user: userID,
      scope: 'user'
    },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  };

  try {
    const response = await axios.request(options);
    webhooks = response.data

  } catch (error) {
    logger.forBot().error(`Error fetching webhook subscriptions: ${error}`);
  }

  return webhooks
}

export function findWebhookSubscriptionByCallbackUrl(
  collection: WebhookSubscription[],
  callbackUrl: string
): WebhookSubscription | null {
  return collection.find(subscription => subscription.callback_url === callbackUrl) || null;
}