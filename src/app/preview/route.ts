import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function GET(request: NextRequest) {
  try {
    // Get host from request to construct absolute URL for the widget
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;

    // Fetch the actual ifg.gr site
    const response = await fetch('https://www.ifg.gr/');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ifg.gr: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Use cheerio to parse and inject our script and base tags
    const $ = cheerio.load(html);
    
    // Inject base tag to fix relative links and assets (images, css, etc.)
    $('head').prepend('<base href="https://www.ifg.gr/">');
    
    // Inject the widget script
    $('body').append(`<script src="${baseUrl}/widget.js"></script>`);

    // Return the modified HTML
    return new NextResponse($.html(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Optional: Ensure the preview doesn't get cached
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Preview route error:', error);
    return new NextResponse('Error generating preview. Check server logs.', { status: 500 });
  }
}
