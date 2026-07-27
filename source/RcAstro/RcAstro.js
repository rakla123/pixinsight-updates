#engine v8

#feature-id RCAstroCLIWrapper : Utilities > RC-Astro CLI Wrapper
#feature-icon RcAstro.svg
#feature-info RC-Astro command-line interface wrapper for BlurXTerminator, StarXTerminator, and NoiseXTerminator.<br/>Copyright (c) 2026 FlapAstro. PolyForm Noncommercial License 1.0.0.

// RcAstro.js
// PixInsight PJSR V8 GUI wrapper for RC-Astro CLI.
// Required Notice: Copyright (c) 2026 FlapAstro.
// Required Notice: This software is provided "AS IS", without warranty of any
// kind, including fitness for a particular purpose. Use is entirely at the
// user's sole risk and responsibility.
// Licensed under the PolyForm Noncommercial License 1.0.0.
// Compatible with RC-Astro CLI 1.0.0+; tested with CLI 1.1.0.
//
// Third-party software:
// RC-Astro CLI, BlurXTerminator, StarXTerminator, and NoiseXTerminator are
// proprietary software of RC Astro, LLC and are subject to RC Astro's separate
// license agreement. PixInsight is software of Pleiades Astrophoto S.L. and is
// subject to its separate license terms. Neither third-party product is
// included with or licensed under this script's PolyForm license.
// All product names and trademarks belong to their respective owners. This
// script is an independent wrapper and is not endorsed by either company.
//
// Features:
// - Active PixInsight view mode:
//      saves active/target view to temp XISF,
//      runs RC-Astro CLI,
//      opens processed output as a new PixInsight image window.
// - Manual file mode.
// - Tool-specific GUI visibility:
//      BXT shows only BXT parameters.
//      SXT shows only SXT parameters.
//      NXT shows only NXT parameters.
// - Explicit command-specific arguments:
//      BXT: sharpen stars, star halos, automatic/manual nonstellar PSF, sharpen nonstellar, correct-only
//      SXT: optional stars output, optional unscreened stars
//      NXT: denoise channels/frequency bands, frequency scale, iterations
// - Common options:
//      device, ML version, overlap, depth
// - Tool-specific extra args retained as fallback.
// - Live progress parsing from RC-Astro output.
// - GPU parsing/reporting.
// - Progress shown in script window only.
// - Console limited to summary.
// - Full stdout/stderr log.

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

var RCASTRO_MINIMUM_VERSION = [ 1, 0, 0 ];
var RCASTRO_TESTED_VERSION = [ 1, 1, 0 ];
var RCASTRO_WRAPPER_VERSION = "1.0.0";
var rcAstroVersionCache = {};
var RCASTRO_SCRIPT_DIRECTORY =
   File.extractDrive( #__FILE__ ) + File.extractDirectory( #__FILE__ );

// -----------------------------------------------------------------------------
// Utility functions
// -----------------------------------------------------------------------------

function nowString()
{
   return (new Date()).toString();
}

function trimString( s )
{
   return String( s ).replace( /^\s+|\s+$/g, "" );
}

function isNonZeroNumberString( s )
{
   var text = trimString( s );

   if ( text.length == 0 )
      return false;

   var value = Number( text );
   if ( !isFinite( value ) )
      return true;

   return value != 0;
}

function stringArrayContains( a, value )
{
   for ( var i = 0; i < a.length; ++i )
      if ( a[i] == value )
         return true;

   return false;
}

function stringArraysOverlap( a, b )
{
   for ( var i = 0; i < a.length; ++i )
      if ( stringArrayContains( b, a[i] ) )
         return true;

   return false;
}

function appendUniqueStrings( target, values )
{
   for ( var i = 0; i < values.length; ++i )
      if ( !stringArrayContains( target, values[i] ) )
         target.push( values[i] );
}

function appendNxtDenoiseOption( args, flag, value, bands, usedBands )
{
   if ( !isNonZeroNumberString( value ) )
      return;

   if ( stringArraysOverlap( bands, usedBands ) )
      return;

   args.push( flag );
   args.push( trimString( value ) );
   appendUniqueStrings( usedBands, bands );
}

function fileExists( path )
{
   try
   {
      return File.exists( path );
   }
   catch ( e )
   {
      return false;
   }
}

function directoryExists( path )
{
   try
   {
      return File.directoryExists( path );
   }
   catch ( e )
   {
      return false;
   }
}

function removeFileIfExists( path )
{
   try
   {
      if ( fileExists( path ) )
         File.remove( path );
   }
   catch ( e )
   {
      throw new Error( "Could not remove temporary file:\n" + path + "\n\n" + e.toString() );
   }
}

function directoryOfPath( path )
{
   path = String( path );
   return File.extractDrive( path ) + File.extractDirectory( path );
}

function samePath( a, b )
{
   return String( a ).replace( /\\/g, "/" ).toLowerCase() ==
          String( b ).replace( /\\/g, "/" ).toLowerCase();
}

function fileSize( path )
{
   var f = new File;
   try
   {
      f.openForReading( path );
      return f.size;
   }
   catch ( e )
   {
      return -1;
   }
   finally
   {
      try
      {
         if ( f.isOpen )
            f.close();
      }
      catch ( ignored )
      {
      }
   }
}

function quoteForLog( s )
{
   return "\"" + String( s ).replace( /\\/g, "\\\\" ).replace( /"/g, "\\\"" ) + "\"";
}

function quoteArgsForLog( args )
{
   var s = "";

   for ( var i = 0; i < args.length; ++i )
   {
      if ( i > 0 )
         s += " ";

      s += quoteForLog( args[i] );
   }

   return s;
}

function splitCommandLine( s )
{
   var args = [];
   var current = "";
   var inQuotes = false;
   var escaped = false;

   for ( var i = 0; i < s.length; ++i )
   {
      var c = s.charAt( i );

      if ( escaped )
      {
         current += c;
         escaped = false;
         continue;
      }

      if ( c == "\\" )
      {
         var next = ( i + 1 < s.length ) ? s.charAt( i + 1 ) : "";

         if ( next == "\\" || next == "\"" )
            escaped = true;
         else
            current += c;

         continue;
      }

      if ( c == '"' )
      {
         inQuotes = !inQuotes;
         continue;
      }

      if ( !inQuotes && /\s/.test( c ) )
      {
         if ( current.length > 0 )
         {
            args.push( current );
            current = "";
         }
      }
      else
      {
         current += c;
      }
   }

   if ( inQuotes )
      throw new Error( "Unbalanced quote in extra command-line arguments:\n" + s );

   if ( escaped )
      current += "\\";

   if ( current.length > 0 )
      args.push( current );

   return args;
}

function appendSplitArgs( targetArgs, argString )
{
   argString = trimString( argString );

   if ( argString.length == 0 )
      return;

   var extra = splitCommandLine( argString );

   for ( var i = 0; i < extra.length; ++i )
      targetArgs.push( extra[i] );
}

function sanitizeIdentifier( s )
{
   s = String( s );
   s = s.replace( /[^A-Za-z0-9_]/g, "_" );
   s = s.replace( /^_+/, "" );

   if ( s.length == 0 )
      s = "image";

   if ( s.match( /^[0-9]/ ) )
      s = "img_" + s;

   return s;
}

function pathJoin( dir, file )
{
   dir = String( dir );

   if ( dir.length == 0 )
      return file;

   var last = dir.charAt( dir.length - 1 );

   if ( last == "/" || last == "\\" )
      return dir + file;

   return dir + "/" + file;
}

function defaultTempDirectory()
{
   return File.systemTempDirectory;
}

function defaultRCAstroExecutable()
{
   var candidates = [
      "C:/Program Files/RC-Astro/cli/rc-astro.exe",
      "C:/Program Files/RC-Astro/rc-astro.exe",
      "C:/Program Files (x86)/RC-Astro/cli/rc-astro.exe"
   ];

   for ( var i = 0; i < candidates.length; ++i )
      if ( fileExists( candidates[i] ) )
         return candidates[i];

   return candidates[0];
}

function settingsReadString( key, fallback )
{
   try
   {
      var value = Settings.read( key, DataType.String );
      if ( value != null )
         return String( value );
   }
   catch ( ignored )
   {
   }

   return fallback;
}

function settingsReadBoolean( key, fallback )
{
   try
   {
      var value = Settings.read( key, DataType.Boolean );
      if ( value != null )
         return Boolean( value );
   }
   catch ( ignored )
   {
   }

   return fallback;
}

function settingsWriteString( key, value )
{
   try
   {
      Settings.write( key, DataType.String, String( value ) );
   }
   catch ( ignored )
   {
   }
}

function settingsWriteBoolean( key, value )
{
   try
   {
      Settings.write( key, DataType.Boolean, Boolean( value ) );
   }
   catch ( ignored )
   {
   }
}

function toolSuffix( tool )
{
   if ( tool == "bxt" )
      return "_BXT";

   if ( tool == "sxt" )
      return "_SXT";

   if ( tool == "nxt" )
      return "_NXT";

   return "_" + tool;
}

function showMessage( title, text, icon )
{
   try
   {
      (new MessageBox(
         text,
         title,
         icon,
         StdButton.Ok
      )).execute();
   }
   catch ( e )
   {
   }
}

function writeConsoleInfo( title, text )
{
   console.noteln( "<end><cbr><br>* " + title );
   if ( text && String( text ).length > 0 )
      console.noteln( text );
   console.flush();
}

function writeConsoleWarning( title, text )
{
   console.warningln( "<end><cbr><br>** Warning: " + title );
   console.warningln( text );
   console.flush();
}

function showWarning( title, text )
{
   writeConsoleWarning( title, text );
   showMessage( title, text, StdIcon.Warning );
}

function writeConsoleError( title, text )
{
   console.criticalln( "<end><cbr><br>*** Error: " + title );
   console.criticalln( text );
   console.flush();
}

function showError( title, text )
{
   writeConsoleError( title, text );
   showMessage( title, text, StdIcon.Error );
}

// -----------------------------------------------------------------------------
// RC-Astro output parsing
// -----------------------------------------------------------------------------

function extractLatestRCAstroProgress( text )
{
   if ( !text )
      return null;

   var s = String( text );

   // RC-Astro progress often uses carriage returns.
   s = s.replace( /\r/g, "\n" );
   s = s.replace( /Processing \[/g, "\nProcessing [" );

   var lines = s.split( "\n" );
   var latest = null;

   for ( var i = 0; i < lines.length; ++i )
   {
      var line = lines[i];

      var m = line.match(
         /Processing\s+\[([=\s]+)\]\s+(\d+)%\s+([0-9.]+)\s+MP\/s\s+ETA\s+([0-9:]+)/
      );

      if ( m )
      {
         latest = {
            raw: line,
            bar: m[1],
            percent: parseInt( m[2], 10 ),
            speed: m[3],
            eta: m[4]
         };
      }
   }

   return latest;
}

function extractRCAstroGpu( text )
{
   if ( !text )
      return "";

   var s = String( text );
   var gpu = s.match( /Using gpu:\s*([^\r\n]+)/ );

   if ( gpu )
      return trimString( gpu[1] );

   return "";
}

function extractRCAstroToolInfo( text )
{
   if ( !text )
      return "";

   var s = String( text );

   var ai = s.match( /(BlurXTerminator|StarXTerminator|NoiseXTerminator)[^\r\n]*/ );
   if ( ai )
      return trimString( ai[0] );

   return "";
}

function makeTextProgressBar( percent, width )
{
   if ( percent < 0 )
      percent = 0;

   if ( percent > 100 )
      percent = 100;

   var filled = Math.round( width * percent / 100 );
   var s = "[";

   for ( var i = 0; i < width; ++i )
      s += ( i < filled ) ? "#" : "-";

   s += "]";
   return s;
}

function makeMovingBar( frame, width )
{
   var pos = frame % width;
   var s = "[";

   for ( var j = 0; j < width; ++j )
   {
      if ( j == pos )
         s += "#";
      else if ( j == pos - 1 || j == pos + 1 )
         s += "=";
      else
         s += "-";
   }

   s += "]";
   return s;
}

function tailString( s, maxLength )
{
   s = String( s );

   if ( s.length <= maxLength )
      return s;

   return s.substring( s.length - maxLength );
}

function readProcessText( process, streamName )
{
   var data = streamName == "stdout" ? process.stdout : process.stderr;
   return data.length > 0 ? data.utf8ToString() : "";
}

function externalProcessIsRunning( process )
{
   return process.isRunning;
}

function stopExternalProcess( process )
{
   if ( process && process.isRunning )
      process.terminate();
}

function versionString( version )
{
   return version[0] + "." + version[1] + "." + version[2];
}

function compareVersions( a, b )
{
   for ( var i = 0; i < 3; ++i )
   {
      if ( a[i] < b[i] )
         return -1;
      if ( a[i] > b[i] )
         return 1;
   }

   return 0;
}

function parseRCAstroVersion( text )
{
   text = String( text );

   try
   {
      var document = JSON.parse( trimString( text ) );
      if ( document && document.cliVersion )
         text = String( document.cliVersion );
   }
   catch ( ignored )
   {
      var jsonMatch = text.match(
         /"cliVersion"\s*:\s*"([0-9]+\.[0-9]+\.[0-9]+(?:[-+][^"]*)?)"/i
      );
      if ( jsonMatch )
         text = jsonMatch[1];
   }

   var match = text.match( /(?:^|[^0-9])v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:[^0-9]|$)/i );
   if ( !match )
      return null;

   return [ Number( match[1] ), Number( match[2] ), Number( match[3] ) ];
}

function verifyRCAstroCompatibility( executable )
{
   executable = trimString( executable );

   if ( executable.length == 0 )
      throw new Error( "No RC-Astro CLI executable is configured." );

   if ( !fileExists( executable ) || directoryExists( executable ) )
      throw new Error( "RC-Astro CLI executable was not found:\n" + executable );

   var cacheKey = executable.replace( /\\/g, "/" ).toLowerCase();
   if ( rcAstroVersionCache[cacheKey] )
      return rcAstroVersionCache[cacheKey];

   var process = new ExternalProcess;
   process.start( executable, [ "--json" ] );

   if ( !process.waitForFinished( 10000 ) )
   {
      stopExternalProcess( process );
      throw new Error(
         "RC-Astro CLI did not respond to the version check within 10 seconds:\n" +
         executable
      );
   }

   var stdoutText = readProcessText( process, "stdout" );
   var stderrText = readProcessText( process, "stderr" );
   var combined = stdoutText + "\n" + stderrText;

   if ( process.exitCode !== 0 )
      throw new Error(
         "RC-Astro CLI version check failed with exit code " +
         process.exitCode + ".\n\n" +
         tailString( combined, 4000 )
      );

   var version = parseRCAstroVersion( combined );
   if ( version == null )
      throw new Error(
         "RC-Astro CLI is present, but its version coulÛİ5öÚ$z{-®éÜj×VDÆ—fRĞĞ¢F–Å7G&–ær‚7FF÷WD'VffW"Â'6UF–ÄÆVæwF‚’²%Æâ"°Ğ¢F–Å7G&–ær‚7FFW'$'VffW"Â'6UF–ÄÆVæwF‚“°Ğ Ğ¢ÆFW7E&öw&W72ÒW‡G&7DÆFW7E$47G&õ&öw&W72‚6öÖ&–æVDÆ—fR“°Ğ Ğ¢f"wTÆ—fRÒW‡G&7E$47G&ôwR‚6öÖ&–æVDÆ—fR“°Ğ¢–b‚wTÆ—fRæÆVæwF‚âĞ¢wUW6VBÒwTÆ—fS°Ğ Ğ¢f"FööÄ–æfôÆ—fRÒW‡G&7E$47G&õFööÄ–æfò‚6öÖ&–æVDÆ—fR“°Ğ¢–b‚FööÄ–æfôÆ—fRæÆVæwF‚âĞ¢FööÄ–æfòÒFööÄ–æfôÆ—fS°Ğ¢ĞĞ Ğ¢–b‚ÆFW7E&öw&W72ÒçVÆÂĞ¢°Ğ¢†DÆ—fU&öw&W72ÒG'VS°Ğ Ğ¢f"&öw&W74¶W’ĞĞ¢ÆFW7E&öw&W72çW&6VçB²'Â"°Ğ¢ÆFW7E&öw&W72ç7VVB²'Â"°Ğ¢ÆFW7E&öw&W72æWF²'Â"°Ğ¢VÆ6VE6V6öæG2²'Â"°Ğ¢wUW6VB²'Â"°Ğ¢FööÄ–æfó°Ğ Ğ¢–b‚&öw&W74¶W’ÒÆ7E&öw&W74¶W’ÇÀĞ¢ÆFW7E&öw&W72çW&6VçBÒÆ7EW&6VçBÇÀĞ¢VÆ6VE6V6öæG2ÒÆ7DF—7Æ–VE6V6öæBĞ¢°Ğ¢f"&öw&W74&"ÒÖ¶UFW‡E&öw&W74&"‚ÆFW7E&öw&W72çW&6VçBÂ3“°Ğ Ğ¢WFFUFW‡D&÷„–d6†ævVB€Ğ¢6VÆbç7FGW5FW‡BÀĞ¢%%Tää”äuÆåÆâ"°Ğ¢%$2Ô7G&ò—2&ö6W76–æråÆåÆâ"°Ğ¢&öw&W74&"²""²ÆFW7E&öw&W72çW&6VçB²"UÆåÆâ"°Ğ¢%7VVC¢"²ÆFW7E&öw&W72ç7VVB²"Õ÷5Æâ"°Ğ¢$UD¢"²ÆFW7E&öw&W72æWF²%Æâ"°Ğ¢$VÆ6VC¢"²VÆ6VE6V6öæG2²"5Æâ"°Ğ¢$uS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢&FWFV7F–ærâââ"’²%Æâ"°Ğ¢$6öÖÖæC¢"²FööÂ²%Æâ"°Ğ¢‚FööÄ–æfòæÆVæwF‚âò%FööÃ¢"²FööÄ–æfò²%Æâ"¢""’°Ğ¢%Æä÷WGWC¥Æâ"°Ğ¢÷WGWDf–ÆR²%ÆåÆâ"°Ğ¢$6öÖÖæBÆ–æS¥Æâ"°Ğ¢6öÖÖæDÆ–æPĞ¢“°Ğ Ğ¢Æ7E&öw&W74¶W’Ò&öw&W74¶W“°Ğ¢Æ7EW&6VçBÒÆFW7E&öw&W72çW&6VçC°Ğ¢Æ7DF—7Æ–VE6V6öæBÒVÆ6VE6V6öæG3°Ğ¢ĞĞ¢ĞĞ¢VÇ6PĞ¢°Ğ¢–b‚VÆ6VE6V6öæG2ÒÆ7DF—7Æ–VE6V6öæBĞ¢°Ğ¢f"7–ææW"Ò7–ææW$g&ÖW5²g&ÖRR7–ææW$g&ÖW2æÆVæwF‚Ó°Ğ¢f"Ö÷f–æt&"ÒÖ¶TÖ÷f–æt&"‚g&ÖRÂ3“°Ğ Ğ¢WFFUFW‡D&÷„–d6†ævVB€Ğ¢6VÆbç7FGW5FW‡BÀĞ¢%%Tää”är"²7–ææW"²%ÆåÆâ"°Ğ¢%$2Ô7G&ò†27F'FVBåÆåÆâ"°Ğ¢%v—F–ærf÷"'6V&ÆR&öw&W72÷WGWBââåÆåÆâ"°Ğ¢Ö÷f–æt&"²%ÆåÆâ"°Ğ¢$VÆ6VC¢"²VÆ6VE6V6öæG2²"5Æâ"°Ğ¢$uS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢&FWFV7F–ærâââ"’²%Æâ"°Ğ¢$6öÖÖæC¢"²FööÂ²%Æâ"°Ğ¢‚FööÄ–æfòæÆVæwF‚âò%FööÃ¢"²FööÄ–æfò²%Æâ"¢""’°Ğ¢%Æä÷WGWC¥Æâ"°Ğ¢÷WGWDf–ÆR²%ÆåÆâ"°Ğ¢$6öÖÖæBÆ–æS¥Æâ"°Ğ¢6öÖÖæDÆ–æPĞ¢“°Ğ Ğ¢Æ7DF—7Æ–VE6V6öæBÒVÆ6VE6V6öæG3°Ğ¢ĞĞ¢ĞĞ Ğ¢f"6–ÆVçE6V6öæG2ÒÖF‚æfÆö÷"€Ğ¢‚æ÷rævWEF–ÖR‚’ÒÆ7D÷WGWD6†ævUF–ÖRævWEF–ÖR‚’’ò Ğ¢“°Ğ Ğ¢–b‚6–ÆVçE6V6öæG2âÖ…6–ÆVçE6V6öæG2Ğ¢°Ğ¢7F÷W‡FW&æÅ&ö6W72‚“°Ğ¢F‡&÷ræWrW'&÷"€Ğ¢%$2Ô7G&ò&öGV6VBæòæWr÷WGWBf÷""°Ğ¢Ö…6–ÆVçE6V6öæG2²"6V6öæG2Â6òF†R67&—B7F÷VBv—F–æråÆåÆâ"°Ğ¢%'F–Â7FF÷WC¥Æâ"²F–Å7G&–ær‚7FF÷WD'VffW"ÂC’²%ÆåÆâ"°Ğ¢%'F–Â7FFW'#¥Æâ"²F–Å7G&–ær‚7FFW'$'VffW"ÂCĞ¢“°Ğ¢ĞĞ Ğ¢–b‚VÆ6VE6V6öæG2ÒÆ7DÆöu&Vg&W6…6V6öæBbbVÆ6VE6V6öæG2RRÓÒĞ¢°Ğ¢Æ7DÆöu&Vg&W6…6V6öæBÒVÆ6VE6V6öæG3°Ğ¢f–ÆRçw&—FUFW‡Df–ÆR€Ğ¢Æötf–ÆRÀĞ¢Æör°Ğ¢%&ö6W72'Vææ–æs¢"²æ÷u7G&–ær‚’²%Æâ"°Ğ¢$VÆ6VC¢"²VÆ6VE6V6öæG2²"5Æâ"°Ğ¢%6–ÆVçC¢"²6–ÆVçE6V6öæG2²"5ÆåÆâ"°Ğ¢"ÒÒÒÒÒÄ•dR5DDõUBD”ÂÒÒÒÒÕÆâ"°Ğ¢F–Å7G&–ær‚7FF÷WD'VffW"Âƒ’²%ÆåÆâ"°Ğ¢"ÒÒÒÒÒÄ•dR5DDU%"D”ÂÒÒÒÒÕÆâ"°Ğ¢F–Å7G&–ær‚7FFW'$'VffW"Âƒ’²%Æâ Ğ¢“°Ğ¢ĞĞ Ğ¢g&ÖR²³°Ğ¢6÷&TÆ–6F–öâç&ö6W74WfVçG2‚“°Ğ¢ĞĞ Ğ¢f"VæEF–ÖRÒæWrFFR‚“°Ğ¢f"F÷FÅ6V6öæG2ÒÖF‚æfÆö÷"€Ğ¢‚VæEF–ÖRævWEF–ÖR‚’Ò7F'EF–ÖRævWEF–ÖR‚’’ò Ğ¢“°Ğ Ğ¢f"W†—D6öFRÒæW†—D6öFS°Ğ¢7FF÷WD'VffW"³Ò&VE&ö6W75FW‡B‚Â'7FF÷WB"“°Ğ¢7FFW'$'VffW"³Ò&VE&ö6W75FW‡B‚Â'7FFW'""“°Ğ¢f"7FF÷WEFW‡BÒ7FF÷WD'VffW#°Ğ¢f"7FFW'%FW‡BÒ7FFW'$'VffW#°Ğ Ğ¢f"f–æÄ6öÖ&–æVBÒ7FF÷WEFW‡B²%Æâ"²7FFW'%FW‡C°Ğ Ğ¢f"wTf–æÂÒW‡G&7E$47G&ôwR‚f–æÄ6öÖ&–æVB“°Ğ¢–b‚wTf–æÂæÆVæwF‚âĞ¢wUW6VBÒwTf–æÃ°Ğ Ğ¢f"FööÄ–æfôf–æÂÒW‡G&7E$47G&õFööÄ–æfò‚f–æÄ6öÖ&–æVB“°Ğ¢–b‚FööÄ–æfôf–æÂæÆVæwF‚âĞ¢FööÄ–æfòÒFööÄ–æfôf–æÃ°Ğ Ğ¢6VÆbç7FGW5FW‡BçFW‡BĞĞ¢$4ôÕÄUDTEÆåÆâ"°Ğ¢%$2Ô7G&ò†2f–æ—6†VBåÆåÆâ"°Ğ¢$VÆ6VC¢"²F÷FÅ6V6öæG2²"5Æâ"°Ğ¢$W†—B6öFS¢"²W†—D6öFR²%Æâ"°Ğ¢$uS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢'Væ¶æ÷vâ"’²%ÆåÆâ"°Ğ¢$6†V6¶–ær÷WGWBæBw&—F–ærÆörâââ#°Ğ Ğ¢6÷&TÆ–6F–öâç&ö6W74WfVçG2‚“°Ğ Ğ¢Æör³Ò$W†—B6öFS¢"²W†—D6öFR²%Æâ#°Ğ¢Æör³Ò$VÆ6VC¢"²F÷FÅ6V6öæG2²"5Æâ#°Ğ¢Æör³Ò$Æ—fR&öw&W72'6VC¢"²‚†DÆ—fU&öw&W72ò'–W2"¢&æò"’²%Æâ#°Ğ¢Æör³Ò$uRW6VC¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢'Væ¶æ÷vâ"’²%Æâ#°Ğ¢Æör³Ò%FööÂ–æfó¢"²‚FööÄ–æfòæÆVæwF‚âòFööÄ–æfò¢'Væ¶æ÷vâ"’²%ÆåÆâ#°Ğ¢Æör³Ò"ÒÒÒÒÒ5DDõUBÒÒÒÒÕÆâ#°Ğ¢Æör³Ò7FF÷WEFW‡B²%ÆåÆâ#°Ğ¢Æör³Ò"ÒÒÒÒÒ5DDU%"ÒÒÒÒÕÆâ#°Ğ¢Æör³Ò7FFW'%FW‡B²%ÆåÆâ#°Ğ¢Æör³Ò$f–æ—6†VC¢"²æ÷u7G&–ær‚’²%Æâ#°Ğ Ğ¢f–ÆRçw&—FUFW‡Df–ÆR‚Æötf–ÆRÂÆör“°Ğ Ğ¢w&—FT6öç6öÆT–æfò€Ğ¢%$2Ô7G&ò&ö6W726ö×ÆWFVB"ÀĞ¢$VÆ6VC¢"²F÷FÅ6V6öæG2²"2"°Ğ¢%ÆäW†—B6öFS¢"²W†—D6öFR°Ğ¢%ÆäuS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢'Væ¶æ÷vâ"’°Ğ¢%ÆäÆörf–ÆS¢"²Æötf–ÆPĞ¢“°Ğ Ğ¢–b‚W†—D6öFRÓÓÒĞ¢°Ğ¢–b‚f–ÆTW†—7G2‚÷WGWDf–ÆR’bbf–ÆU6—¦R‚÷WGWDf–ÆR’âĞ¢°Ğ¢f"7‡E7F'4÷WGWDf–ÆRÒ"#°Ğ¢f"7‡E7F'4÷VæVBÒfÇ6S°Ğ Ğ¢–b‚÷Vå&W7VÇBĞ¢°Ğ¢6VÆbç7FGW5FW‡BçFW‡BĞĞ¢$õTä”är$U5TÅEÆåÆâ"°Ğ¢%$2Ô7G&òf–æ—6†VB7V66W76gVÆÇ’åÆåÆâ"°Ğ¢$÷Væ–ær÷WGWB–â—„–ç6–v‡C¥Æâ"°Ğ¢÷WGWDf–ÆS°Ğ Ğ¢6÷&TÆ–6F–öâç&ö6W74WfVçG2‚“°Ğ Ğ¢f"÷VæVE&W7VÇBÒ÷Vä÷WGWD–ÖvR€Ğ¢÷WGWDf–ÆRÀĞ¢–çWDF—7Æ•7FFPĞ¢“°Ğ¢÷WGWEv–æF÷rÒ÷VæVE&W7VÇBçv–æF÷s°Ğ¢&W7VÇDF—7Æ”FW67&—F–öâĞĞ¢÷VæVE&W7VÇBæF—7Æ”FW67&—F–öã°Ğ¢Æör³Ò%&W7VÇB5Dc¢"°Ğ¢&W7VÇDF—7Æ”FW67&—F–öâ²%Æâ#°Ğ¢ĞĞ Ğ¢–b‚FööÂÓÒ'7‡B"bb6VÆbç7‡E7F'46†V6²æ6†V6¶VBĞ¢°Ğ¢7‡E7F'4÷WGWDf–ÆRÒf–æE7‡E7F'4÷WGWDf–ÆR‚÷WGWDf–ÆR“°Ğ Ğ¢–b‚7‡E7F'4÷WGWDf–ÆRæÆVæwF‚âĞ¢°Ğ¢6VÆbç7FGW5FW‡BçFW‡BĞĞ¢$õTä”är5…B5D%2”ÔtUÆåÆâ"°Ğ¢%$2Ô7G&òf–æ—6†VB7V66W76gVÆÇ’åÆåÆâ"°Ğ¢$÷Væ–ær7F'2ÖöæÇ’÷WGWB–â—„–ç6–v‡C¥Æâ"°Ğ¢7‡E7F'4÷WGWDf–ÆS°Ğ Ğ¢6÷&TÆ–6F–öâç&ö6W74WfVçG2‚“°Ğ Ğ¢f"÷VæVE7F'2Ò÷Vä÷WGWD–ÖvR€Ğ¢7‡E7F'4÷WGWDf–ÆRÀĞ¢–çWDF—7Æ•7FFPĞ¢“°Ğ¢7‡E7F'4÷VæVBÒG'VS°Ğ¢Æör³Ò%5…B7F'3¢"²7‡E7F'4÷WGWDf–ÆR²%Æâ#°Ğ¢Æör³Ò%7F'25Dc¢"°Ğ¢÷VæVE7F'2æF—7Æ”FW67&—F–öâ²%Æâ#°Ğ¢ĞĞ¢VÇ6PĞ¢°Ğ¢Æör³Ò%5…B7F'3¢&WVW7FVBÂ'WBæò6ö×æ–öâ7F'2ÖöæÇ’÷WGWBv2f÷VæB&W6–FRF†R7F&ÆW72÷WGWBåÆâ#°Ğ¢ĞĞ¢ĞĞ Ğ¢f–ÆRçw&—FUFW‡Df–ÆR‚Æötf–ÆRÂÆör“°Ğ Ğ¢f"f–æÄ&"ÒÖ¶UFW‡E&öw&W74&"‚Â3“°Ğ Ğ¢6VÆbç7FGW5FW‡BçFW‡BĞĞ¢%5T44U55ÆåÆâ"°Ğ¢%$2Ô7G&òf–æ—6†VB7V66W76gVÆÇ’åÆåÆâ"°Ğ¢f–æÄ&"²"UÆåÆâ"°Ğ¢$VÆ6VC¢"²F÷FÅ6V6öæG2²"5Æâ"°Ğ¢$W†—B6öFS¢Æâ"°Ğ¢$uS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢'Væ¶æ÷vâ"’²%Æâ"°Ğ¢$6öÖÖæC¢"²FööÂ²%Æâ"°Ğ¢‚FööÄ–æfòæÆVæwF‚âò%FööÃ¢"²FööÄ–æfò²%Æâ"¢""’°Ğ¢$ÖöFS¢"²‚W6T7F—fUf–Wrò&7F—fR—„–ç6–v‡Bf–Wr"¢&ÖçVÂf–ÆR"’²%Æâ"°Ğ¢%&W7VÇB÷VæVC¢"²‚÷Vå&W7VÇBò'–W2"¢&æò"’²%ÆåÆâ"°Ğ¢‚7‡E7F'4÷WGWDf–ÆRæÆVæwF‚âò%5…B7F'2÷VæVC¢"²‚7‡E7F'4÷VæVBò'–W2"¢&æò"’²%ÆåÆâ"¢""’°Ğ¢$÷WGWC¥Æâ"²÷WGWDf–ÆR²%ÆåÆâ"°Ğ¢‚7‡E7F'4÷WGWDf–ÆRæÆVæwF‚âò%5…B7F'2÷WGWC¥Æâ"²7‡E7F'4÷WGWDf–ÆR²%ÆåÆâ"¢""’°Ğ¢$Æös¥Æâ"²Æötf–ÆS°Ğ Ğ¢ĞĞ¢VÇ6PĞ¢°Ğ¢6VÆbç7FGW5FW‡BçFW‡BĞĞ¢%t$ä”äuÆåÆâ"°Ğ¢%$2Ô7G&ò&WGW&æVBW†—B6öFRÂ'WBF†RW‡V7FVB÷WGWBf–ÆR—2Ö—76–ær÷"V×G’åÆåÆâ"°Ğ¢$VÆ6VC¢"²F÷FÅ6V6öæG2²"5Æâ"°Ğ¢$uS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢'Væ¶æ÷vâ"’²%ÆåÆâ"°Ğ¢$W‡V7FVB÷WGWC¥Æâ"²÷WGWDf–ÆR²%ÆåÆâ"°Ğ¢$Æös¥Æâ"²Æötf–ÆS°Ğ Ğ¢w&—FT6öç6öÆUv&æ–ær€Ğ¢%$2Ô7G&òv&æ–ær"ÀĞ¢%$2Ô7G&ò&WGW&æVBW†—B6öFRÂ'WBF†RW‡V7FVB÷WGWBf–ÆR—2Ö—76–ær÷"V×G’åÆåÆâ"°Ğ¢$VÆ6VC¢"²F÷FÅ6V6öæG2²"5Æâ"°Ğ¢$uS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢'Væ¶æ÷vâ"’²%ÆåÆâ"°Ğ¢$W‡V7FVB÷WGWC¥Æâ"²÷WGWDf–ÆR²%ÆåÆâ"°Ğ¢$6†V6²Æös¥Æâ"²Æötf–ÆPĞ¢“°Ğ¢ĞĞ¢ĞĞ¢VÇ6PĞ¢°Ğ¢6VÆbç7FGW5FW‡BçFW‡BĞĞ¢$d”ÄTEÆåÆâ"°Ğ¢%$2Ô7G&ò&WGW&æVBæöâ×¦W&òW†—B6öFRåÆåÆâ"°Ğ¢$VÆ6VC¢"²F÷FÅ6V6öæG2²"5Æâ"°Ğ¢$W†—B6öFS¢"²W†—D6öFR²%Æâ"°Ğ¢$uS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢'Væ¶æ÷vâ"’²%ÆåÆâ"°Ğ¢$Æös¥Æâ"²Æötf–ÆR²%ÆåÆâ"°Ğ¢%5DDU%"F–Ã¥Æâ"²F–Å7G&–ær‚7FFW'%FW‡BÂƒ“°Ğ Ğ¢w&—FT6öç6öÆTW'&÷"€Ğ¢%$2Ô7G&òf–ÆVB"ÀĞ¢%$2Ô7G&ò&WGW&æVBæöâ×¦W&òW†—B6öFS¢"²W†—D6öFR²%ÆåÆâ"°Ğ¢$VÆ6VC¢"²F÷FÅ6V6öæG2²"5Æâ"°Ğ¢$uS¢"²‚wUW6VBæÆVæwF‚âòwUW6VB¢'Væ¶æ÷vâ"’²%ÆåÆâ"°Ğ¢$6†V6²Æös¥Æâ"²Æötf–ÆR²%ÆåÆâ"°Ğ¢%5DDU%"F–Ã¥Æâ"²F–Å7G&–ær‚7FFW'%FW‡BÂƒĞ¢“°Ğ¢ĞĞ¢ĞĞ¢6F6‚‚RĞ¢°Ğ¢Æör³Ò%ÆâÒÒÒÒÒ45$•BU„4UD”ôâÒÒÒÒÕÆâ#°Ğ¢Æör³ÒRçFõ7G&–ær‚’²%Æâ#°Ğ¢Æör³Ò$f–æ—6†VC¢"²æ÷u7G&–ær‚’²%Æâ#°Ğ Ğ¢G'Ğ¢°Ğ¢–b‚Æötf–ÆRbbÆötf–ÆRæÆVæwF‚âĞ¢f–ÆRçw&—FUFW‡Df–ÆR‚Æötf–ÆRÂÆör“°Ğ¢ĞĞ¢6F6‚‚–væ÷&VCRĞ¢°Ğ¢ĞĞ Ğ¢–b‚v46æ6VÆÆVBĞ¢°Ğ¢6VÆbç7FGW5FW‡BçFW‡BĞĞ¢$4ä4TÄÄTEÆåÆâ"°Ğ¢%$2Ô7G&ò&ö6W76–ærv26æ6VÆÆVBåÆåÆâ"°Ğ¢$Æös¥Æâ"²Æötf–ÆS°Ğ Ğ¢w&—FT6öç6öÆUv&æ–ær€Ğ¢%$2Ô7G&ò6æ6VÆÆVB"ÀĞ¢%&ö6W76–ærv26æ6VÆÆVBåÆåÆäÆös¥Æâ"²Æötf–ÆPĞ¢“°Ğ¢ĞĞ¢VÇ6PĞ¢°Ğ¢6VÆbç7FGW5FW‡BçFW‡BĞĞ¢%45$•BU%$õ%ÆåÆâ"°Ğ¢RçFõ7G&–ær‚’²%ÆåÆâ"°Ğ¢$Æös¥Æâ"²Æötf–ÆS°Ğ Ğ¢w&—FT6öç6öÆTW'&÷"€Ğ¢%$2Ô7G&ò67&—BW'&÷""ÀĞ¢RçFõ7G&–ær‚’²%ÆåÆäÆös¥Æâ"²Æötf–ÆPĞ¢“°Ğ¢ĞĞ¢ĞĞ¢f–æÆÇĞ¢°Ğ¢–b‚W6T7F—fUf–Wrbb¶VWFV×bbFV×÷&'”–çWDf–ÆRæÆVæwF‚âĞ¢°Ğ¢G'Ğ¢°Ğ¢&VÖ÷fTf–ÆT–dW†—7G2‚FV×÷&'”–çWDf–ÆR“°Ğ¢ĞĞ¢6F6‚‚6ÆVçWW'&÷"Ğ¢°Ğ¢w&—FT6öç6öÆUv&æ–ær€Ğ¢%FV×÷&'’f–ÆR6ÆVçWf–ÆVB"ÀĞ¢6ÆVçWW'&÷"çFõ7G&–ær‚Ğ¢“°Ğ¢ĞĞ¢ĞĞ Ğ¢6VÆbç'Vä'WGFöâæVæ&ÆVBÒG'VS°Ğ¢6VÆbææWt–ç7Fæ6T'WGFöâæVæ&ÆVBÒG'VS°Ğ¢6VÆbç&VfW&Væ6W4'WGFöâæVæ&ÆVBÒG'VS°Ğ¢6VÆbç&ö6W75'Vææ–ærÒfÇ6S°Ğ¢6VÆbæ6æ6VÅ&WVW7FVBÒfÇ6S°Ğ¢6VÆbæ6Æ÷6T'WGFöâçFW‡BÒ$6Æ÷6R#°Ğ¢6VÆbæ6Æ÷6T'WGFöâæVæ&ÆVBÒG'VS°Ğ¢6÷&TÆ–6F–öâç&ö6W74WfVçG2‚“°Ğ¢ĞĞ¢Ó°Ğ Ğ¢F†—2çWFFUFööÅf—6–&–Æ—G’‚“°Ğ¢F†—2æF§W7EFô6öçFVçG2‚“°Ğ¢ĞĞ§Ó°Ğ Ğ¢òòÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒĞĞ¢òòÆVæ6‚uTĞ¢òòÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒÒĞĞ Ğ¦6öç6öÆRç6†÷r‚“°Ğ§w&—FT6öç6öÆT–æfò‚%$2Ô7G&òuT’w&W"ÆöFVB"Â""“°Ğ Ğ§f"7F'GWW†V7WF&ÆRÒ6WGF–æw5&VE7G&–ær€Ğ¢%&47G&ôuT’öW†R"ÀĞ¢FVfVÇE$47G&ôW†V7WF&ÆR‚Ğ¢“°Ğ§f"7F'GW6Æ•fW'6–öâÒçVÆÃ°Ğ§f"7F'GW6Æ”W'&÷"Ò"#°Ğ Ğ§G'Ğ§°Ğ¢7F'GW6Æ•fW'6–öâÒfW&–g•$47G&ô6ö×F–&–Æ—G’‚7F'GWW†V7WF&ÆR“°Ğ¢w&—FT6öç6öÆT–æfò€Ğ¢%$2Ô7G&ò4Ä’FWFV7FVB"ÀĞ¢%fW'6–öã¢"²fW'6–öå7G&–ær‚7F'GW6Æ•fW'6–öâ’°Ğ¢%ÆäW†V7WF&ÆS¢"²7F'GWW†V7WF&ÆPĞ¢“°Ğ§ĞĞ¦6F6‚‚7F'GWW'&÷"Ğ§°Ğ¢7F'GW6Æ”W'&÷"Ò7F'GWW'&÷"çFõ7G&–ær‚“°Ğ¢6†÷tW'&÷"€Ğ¢%$2Ô7G&ò4Ä’Væf–Æ&ÆR"ÀĞ¢7F'GW6Æ”W'&÷"°Ğ¢%ÆåÆä÷Vâ&VfW&Væ6W2Fò6öæf–wW&R6ö×F–&ÆR$2Ô7G&ò4Ä’W†V7WF&ÆRâ Ğ¢“°Ğ§ĞĞ Ğ§f"F–ÆörÒæWr'Vå$47G&ôF–Æös°Ğ¦F–ÆöræW†V7WFR‚“°Ğ Ğ