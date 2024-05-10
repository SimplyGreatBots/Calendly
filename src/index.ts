import * as botpress from '.botpress'
import * as bpclient from "@botpress/client"
import axios from 'axios'
import { getCurrentUserAPICall, getEventTypesAPICall, findEventTypeUriBySchedulingUrl, getWebhookSubscriptionsAPICall, findWebhookSubscriptionByCallbackUrl } from './client'
import { calendlyWebhookEventSchema, calendlyErrorSchema } from './const'

type scheduleEventOutput = botpress.actions.scheduleEvent.output.Output

export default new botpress.Integration({
  register: async ({ ctx, logger, webhookUrl }) => {
    logger.forBot().info(`Subscribing to Calendly webhook`)
    const accessToken = ctx.configuration.accessToken

    let { organizationID, userID } = await getCurrentUserAPICall(accessToken, logger)
    let webhooks = await getWebhookSubscriptionsAPICall(organizationID, userID, accessToken, logger)

    if (webhooks && webhooks.collection.length > 0) {
      const targetUrl = webhookUrl
      const webhookSubscription = findWebhookSubscriptionByCallbackUrl(webhooks.collection, targetUrl);
      if (webhookSubscription) {
        logger.forBot().info("Webhook already exists. No need to subscribe.")
        return
      }
    }

    const webhookOptions = {
      method: 'POST',
      url: 'https://api.calendly.com/webhook_subscriptions',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      data: {
        url: webhookUrl,
        events: ['invitee.created'],
        organization: organizationID,
        user: userID,
        scope: 'user',
      }
    }

    try {
      const webhookResponse = await axios.request(webhookOptions);
      logger.forBot().info(`Webhook subscription created successfully: ${JSON.stringify(webhookResponse.data)}`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Specific handling for Axios errors
        const statusCode = error.response ? error.response.status : 'No Status Code';
        const statusText = error.response ? error.response.statusText : 'No Status Text';
        const detailedMessage = `Axios error - ${statusCode} ${statusText}: ${error.message}`;
    
        logger.forBot().error(detailedMessage);
        throw new bpclient.RuntimeError(detailedMessage);
      } else {
        // Handle errors expected to match the Calendly error schema
        const result = calendlyErrorSchema.safeParse(error);
    
        if (result.success) {
          logger.forBot().error(`Error creating Calendly webhook subscription: ${result.data.message}`);
          throw new bpclient.RuntimeError(result.data.message);
        } else {
          // Handling unexpected error types
          const errorMessage = `Unexpected error encountered while creating Calendly webhook subscription: ${JSON.stringify(error, null, 2)}`;
          logger.forBot().error(errorMessage);
          throw new bpclient.RuntimeError(errorMessage);
        }
      }
    }
  },
  unregister: async ({ ctx, logger, webhookUrl }) => {
    logger.forBot().info(`Unsubscribing from Calendly webhook`)

    const accessToken = ctx.configuration.accessToken;
    let { organizationID, userID } = await getCurrentUserAPICall(accessToken, logger);
    let webhooks = await getWebhookSubscriptionsAPICall(organizationID, userID, accessToken, logger)

    if (webhooks && webhooks.collection.length > 0) {
      const targetUrl = webhookUrl
      const webhookSubscription = findWebhookSubscriptionByCallbackUrl(webhooks.collection, targetUrl);

      if (webhookSubscription) {
        const webhookUUID = webhookSubscription.uri
        const webhookOptions = {
          method: 'DELETE',
          url: webhookUUID,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          }
        };

        try {
          const webhookResponse = await axios.request(webhookOptions);
          logger.forBot().info(`Webhook subscription successfully removed: ${JSON.stringify(webhookResponse.data)}`);
        } catch (error) {
          logger.forBot().error(`Error removing Calendly webhook subscription: ${JSON.stringify(error)}`)
        }

      } else {
        logger.forBot().info("No webhook matches the provided callback URL. No need to unsubscribe.");
      }
    } else {
      logger.forBot().info("No webhook subscriptions found. No need to unsubcribe.")
    }
  },
  actions: {
    scheduleEvent: async (args): Promise<scheduleEventOutput> => {
      const accessToken = args.ctx.configuration.accessToken

      const { organizationID, userID } = await getCurrentUserAPICall(accessToken, args.logger)
      const collection = await getEventTypesAPICall(userID, accessToken, args.logger)

      if (collection === undefined) {
        args.logger.forBot().error('Event types could not be found.')
        return { link: '' }
      }

      const eventType = findEventTypeUriBySchedulingUrl(collection, args.input.eventTypeUrl)

      if (!eventType || eventType === '') {
        args.logger.forBot().error('Event type not found for URL: ', args.input.eventTypeUrl)
        return { link: '' }
      }
      const scheduleEventOptions = {
        method: 'POST',
        url: 'https://api.calendly.com/scheduling_links',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        data: {
          max_event_count: 1,
          owner: eventType,
          owner_type: 'EventType'
        }
      }

      try {
        const response = await axios.request(scheduleEventOptions)
        const resource = response.data.resource
        const url = new URL(resource.booking_url)

        url.searchParams.set('utm_source', `conversationId=${args.input.conversationId}`)
        args.logger.forBot().debug('Event scheduled successfully', url.href)

        return { link: url.href }

      } catch (error) {
        args.logger.forBot().error('Error scheduling event:', JSON.stringify(error))
        return { link: '' }
      }
    }
  },
  channels: {},
  handler: async ({ logger,client,req }) => {

    const bodyObject = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const parsedData = calendlyWebhookEventSchema.safeParse(bodyObject)

    if (!parsedData.success) {
      logger.forBot().error('Invalid Calendly webhook event:', parsedData.error)
      return
    }

    const utmSource = parsedData.data.payload.tracking.utm_source

    if (utmSource) {
      const conversationIDRegex = /conversationId=([\w]+)/
      const conversationIDMatch = utmSource.match(conversationIDRegex)
      const conversationID = conversationIDMatch ? conversationIDMatch[1] : null

      if (conversationID) {

        try {
          const event = await client.createEvent({
            type: 'calendlyEvent',
            conversationId: conversationID,
            payload: {
              conversation: {
                id: conversationID
              },
              data: parsedData.data.payload
            },
          })
          logger.forBot().debug('Calendly event created successfully.', event)
        } catch (error) {
          logger.forBot().error('Failed to create Calendly event:', error)
        }
      }
      else logger.forBot().warn('Could not find matcing conversation ID. Ensure you are passing event.conversationId into your Schedule Event Link.')
    } else {
      logger.forBot().warn('Could not find UTM source with Conversation ID.')
    }
  },
})
