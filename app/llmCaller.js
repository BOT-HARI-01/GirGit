import { getActiveModel } from "./modelManager.js";
import { GoogleGenAI } from "@google/genai";
import { CohereClientV2 } from "cohere-ai";
import OpenAI from "openai";

export async function askLLM(data) {
  const { key, model } = getActiveModel();
  console.log(key, model)
  if (model === "gemini-2.0-flash") {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        // contents: `You are a helpful assistant. Please clear text and provide correct ouput. If the given is QNA answer with correct option else give the code if needed:\n\n${data}`,
        contents: `You are a helpful assistant. Please clear text and provide correct ouput.
        1. The input can be coding question or template 
        2. The question or conversation between the interviewer and interviewee
        3. The conversation can be a group of peole
        ** Only return the needed data like answer of the converstaion , if it is coding question return the simple explination and code no other unrelated data ** Try to keep the mixture of general explination of approach instead of more going into the programatic approach explination ** Always answer like you are the person getting interviewed and keep the solutions and answers simple, straight with simple words \n\n${data}`,
      });

      return {
        output: response.text,
      };
    } catch (err) {
      console.log(err);
    }
  } else if (model === "command-a-03-2025") {
    const cohere = new CohereClientV2({ token: key });
    const response = await cohere.chat({
      model: "command-a-03-2025",
      messages: [
        {
          role: "user",
          content: `You are a helpful assistant. Please clear text and provide correct ouput. If the given is QNA answer with correct option else give the code if needed:\n\n${data}`,
        },
      ],
    });
    return {
      output: response.message.content[0].text,
    };
  } else if (model === "openai/gpt-4.1-mini") {
    const endpoint = "https://models.github.ai/inference";
    const client = new OpenAI({ baseURL: endpoint, apiKey: key });
    const response = await client.chat.completions.create({
      messages: [
        { role: "system", content: "" },
        { role: "user", content: `You are a helpful assistant. Please clear text and provide correct ouput. If the given is QNA answer with correct option else give the code if needed:\n\n${data}` },
      ],
      temperature: 1,
      top_p: 1,
      model: model,
    });

    return { 
        output: response.choices[0].message.content,
    }
  }
}
