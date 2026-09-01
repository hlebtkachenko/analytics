'use client';

import { Send } from '@bap/design-system/icons';
import {
  AILabel,
  AILabelContent,
  Button,
  Form,
  Heading,
  InlineLoading,
  InlineNotification,
  Section,
  Stack,
  TextArea,
} from '@bap/design-system/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

// The route answers with a UI message stream, and only its text parts reach the panel.
const textDeltaSchema = z.object({
  delta: z.string(),
  type: z.literal('text-delta'),
});

type ChatMessage = Readonly<{
  content: string;
  role: 'assistant' | 'user';
}>;

type DatasetChatProps = Readonly<{
  datasetId: string;
  datasetName: string;
  organizationId: string;
}>;

function readTextDelta(line: string): string | undefined {
  if (!line.startsWith('data:')) {
    return undefined;
  }

  const payload = line.slice('data:'.length).trim();

  if (payload.length === 0 || payload === '[DONE]') {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }

  const chunk = textDeltaSchema.safeParse(parsed);
  return chunk.success ? chunk.data.delta : undefined;
}

export function DatasetChat({
  datasetId,
  datasetName,
  organizationId,
}: DatasetChatProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [streamed, setStreamed] = useState('');
  const [state, setState] = useState<'error' | 'idle' | 'waiting'>('idle');

  async function ask(question: string): Promise<void> {
    const asked: ChatMessage[] = [
      ...messages,
      { content: question, role: 'user' },
    ];
    setMessages(asked);
    setStreamed('');
    setState('waiting');

    try {
      // The organization decides membership and the dataset grounds the answer, both resolved server side.
      const response = await fetch('/api/chat', {
        body: JSON.stringify({ datasetId, messages: asked, organizationId }),
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok || response.body === null) {
        throw new Error('The assistant refused the turn.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const delta = readTextDelta(line);

          if (delta !== undefined) {
            answer += delta;
            setStreamed(answer);
          }
        }
      }

      if (answer.length === 0) {
        throw new Error('The assistant returned no text.');
      }

      setMessages([...asked, { content: answer, role: 'assistant' }]);
      setStreamed('');
      setState('idle');
    } catch {
      setStreamed('');
      setState('error');
    }
  }

  async function submit(formData: FormData): Promise<void> {
    const question = String(formData.get('question') ?? '').trim();

    if (question.length === 0) {
      return;
    }

    await ask(question);
  }

  // A section of its own, so the heading takes the level below whatever encloses the panel.
  return (
    <Section>
      <Stack gap={5}>
        <Stack gap={3} orientation="horizontal">
          <Heading>{t('datasets.chatTitle')}</Heading>
          <AILabel
            aiText={t('datasets.chatLabel')}
            aria-label={t('datasets.chatLabelDescription')}
            size="xs"
            slugLabel={t('datasets.chatLabelDescription')}
          >
            <AILabelContent>
              <p>{t('datasets.chatDisclosure')}</p>
            </AILabelContent>
          </AILabel>
        </Stack>
        <p>{datasetName}</p>
        <ul aria-label={t('datasets.chatLog')} aria-live="polite">
          {messages.map((message, index) => (
            <li key={`${message.role}-${String(index)}`}>
              <strong>
                {message.role === 'user'
                  ? t('datasets.chatSpeakerYou')
                  : t('datasets.chatSpeakerAssistant')}
              </strong>{' '}
              <span>{message.content}</span>
            </li>
          ))}
          {streamed.length > 0 ? (
            <li>
              <strong>{t('datasets.chatSpeakerAssistant')}</strong>{' '}
              <span>{streamed}</span>
            </li>
          ) : null}
        </ul>
        <Form action={submit} aria-label={t('datasets.chatTitle')}>
          <Stack gap={5}>
            <TextArea
              id="dataset-question"
              labelText={t('datasets.chatMessage')}
              name="question"
              placeholder={t('datasets.chatPlaceholder')}
              rows={3}
            />
            <Button
              disabled={state === 'waiting'}
              renderIcon={Send}
              type="submit"
            >
              {t('datasets.chatSend')}
            </Button>
          </Stack>
        </Form>
        {state === 'waiting' ? (
          <InlineLoading description={t('datasets.chatWaiting')} />
        ) : null}
        {state === 'error' ? (
          <InlineNotification
            kind="error"
            lowContrast
            title={t('datasets.chatFailed')}
          />
        ) : null}
      </Stack>
    </Section>
  );
}
