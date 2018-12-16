// The MIT License (MIT)
//
// Copyright (c) 2014 Josh Wolfe
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.yazl=f()}})(function(){var define,module,exports;return function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s}({1:[function(require,module,exports){var fs=require("fs");var Transform=require("stream").Transform;var PassThrough=require("stream").PassThrough;var zlib=require("zlib");var util=require("util");var EventEmitter=require("events").EventEmitter;var crc32=require("buffer-crc32");exports.ZipFile=ZipFile;exports.dateToDosDateTime=dateToDosDateTime;util.inherits(ZipFile,EventEmitter);function ZipFile(){this.outputStream=new PassThrough;this.entries=[];this.outputStreamCursor=0;this.ended=false;this.allDone=false;this.forceZip64Eocd=false}ZipFile.prototype.addFile=function(realPath,metadataPath,options){var self=this;metadataPath=validateMetadataPath(metadataPath,false);if(options==null)options={};var entry=new Entry(metadataPath,false,options);self.entries.push(entry);fs.stat(realPath,function(err,stats){if(err)return self.emit("error",err);if(!stats.isFile())return self.emit("error",new Error("not a file: "+realPath));entry.uncompressedSize=stats.size;if(options.mtime==null)entry.setLastModDate(stats.mtime);if(options.mode==null)entry.setFileAttributesMode(stats.mode);entry.setFileDataPumpFunction(function(){var readStream=fs.createReadStream(realPath);entry.state=Entry.FILE_DATA_IN_PROGRESS;readStream.on("error",function(err){self.emit("error",err)});pumpFileDataReadStream(self,entry,readStream)});pumpEntries(self)})};ZipFile.prototype.addReadStream=function(readStream,metadataPath,options){var self=this;metadataPath=validateMetadataPath(metadataPath,false);if(options==null)options={};var entry=new Entry(metadataPath,false,options);self.entries.push(entry);entry.setFileDataPumpFunction(function(){entry.state=Entry.FILE_DATA_IN_PROGRESS;pumpFileDataReadStream(self,entry,readStream)});pumpEntries(self)};ZipFile.prototype.addBuffer=function(buffer,metadataPath,options){var self=this;metadataPath=validateMetadataPath(metadataPath,false);if(buffer.length>1073741823)throw new Error("buffer too large: "+buffer.length+" > "+1073741823);if(options==null)options={};if(options.size!=null)throw new Error("options.size not allowed");var entry=new Entry(metadataPath,false,options);entry.uncompressedSize=buffer.length;entry.crc32=crc32.unsigned(buffer);entry.crcAndFileSizeKnown=true;self.entries.push(entry);if(!entry.compress){setCompressedBuffer(buffer)}else{zlib.deflateRaw(buffer,function(err,compressedBuffer){setCompressedBuffer(compressedBuffer)})}function setCompressedBuffer(compressedBuffer){entry.compressedSize=compressedBuffer.length;entry.setFileDataPumpFunction(function(){writeToOutputStream(self,compressedBuffer);writeToOutputStream(self,entry.getDataDescriptor());entry.state=Entry.FILE_DATA_DONE;setImmediate(function(){pumpEntries(self)})});pumpEntries(self)}};ZipFile.prototype.addEmptyDirectory=function(metadataPath,options){var self=this;metadataPath=validateMetadataPath(metadataPath,true);if(options==null)options={};if(options.size!=null)throw new Error("options.size not allowed");if(options.compress!=null)throw new Error("options.compress not allowed");var entry=new Entry(metadataPath,true,options);self.entries.push(entry);entry.setFileDataPumpFunction(function(){writeToOutputStream(self,entry.getDataDescriptor());entry.state=Entry.FILE_DATA_DONE;pumpEntries(self)});pumpEntries(self)};ZipFile.prototype.end=function(options,finalSizeCallback){if(typeof options==="function"){finalSizeCallback=options;options=null}if(options==null)options={};if(this.ended)return;this.ended=true;this.finalSizeCallback=finalSizeCallback;this.forceZip64Eocd=!!options.forceZip64Format;pumpEntries(this)};function writeToOutputStream(self,buffer){self.outputStream.write(buffer);self.outputStreamCursor+=buffer.length}function pumpFileDataReadStream(self,entry,readStream){var crc32Watcher=new Crc32Watcher;var uncompressedSizeCounter=new ByteCounter;var compressor=entry.compress?new zlib.DeflateRaw:new PassThrough;var compressedSizeCounter=new ByteCounter;readStream.pipe(crc32Watcher).pipe(uncompressedSizeCounter).pipe(compressor).pipe(compressedSizeCounter).pipe(self.outputStream,{end:false});compressedSizeCounter.on("end",function(){entry.crc32=crc32Watcher.crc32;if(entry.uncompressedSize==null){entry.uncompressedSize=uncompressedSizeCounter.byteCount}else{if(entry.uncompressedSize!==uncompressedSizeCounter.byteCount)return self.emit("error",new Error("file data stream has unexpected number of bytes"))}entry.compressedSize=compressedSizeCounter.byteCount;self.outputStreamCursor+=entry.compressedSize;writeToOutputStream(self,entry.getDataDescriptor());entry.state=Entry.FILE_DATA_DONE;pumpEntries(self)})}function pumpEntries(self){if(self.allDone)return;if(self.ended&&self.finalSizeCallback!=null){var finalSize=calculateFinalSize(self);if(finalSize!=null){self.finalSizeCallback(finalSize);self.finalSizeCallback=null}}var entry=getFirstNotDoneEntry();function getFirstNotDoneEntry(){for(var i=0;i<self.entries.length;i++){var entry=self.entries[i];if(entry.state<Entry.FILE_DATA_DONE)return entry}return null}if(entry!=null){if(entry.state<Entry.READY_TO_PUMP_FILE_DATA)return;if(entry.state===Entry.FILE_DATA_IN_PROGRESS)return;entry.relativeOffsetOfLocalHeader=self.outputStreamCursor;var localFileHeader=entry.getLocalFileHeader();writeToOutputStream(self,localFileHeader);entry.doFileDataPump()}else{if(self.ended){self.offsetOfStartOfCentralDirectory=self.outputStreamCursor;self.entries.forEach(function(entry){var centralDirectoryRecord=entry.getCentralDirectoryRecord();writeToOutputStream(self,centralDirectoryRecord)});writeToOutputStream(self,getEndOfCentralDirectoryRecord(self));self.outputStream.end();self.allDone=true}}}function calculateFinalSize(self){var pretendOutputCursor=0;var centralDirectorySize=0;for(var i=0;i<self.entries.length;i++){var entry=self.entries[i];if(entry.compress)return-1;if(entry.state>=Entry.READY_TO_PUMP_FILE_DATA){if(entry.uncompressedSize==null)return-1}else{if(entry.uncompressedSize==null)return null}entry.relativeOffsetOfLocalHeader=pretendOutputCursor;var useZip64Format=entry.useZip64Format();pretendOutputCursor+=LOCAL_FILE_HEADER_FIXED_SIZE+entry.utf8FileName.length;pretendOutputCursor+=entry.uncompressedSize;if(!entry.crcAndFileSizeKnown){if(useZip64Format){pretendOutputCursor+=ZIP64_DATA_DESCRIPTOR_SIZE}else{pretendOutputCursor+=DATA_DESCRIPTOR_SIZE}}centralDirectorySize+=CENTRAL_DIRECTORY_RECORD_FIXED_SIZE+entry.utf8FileName.length;if(useZip64Format){centralDirectorySize+=ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_SIZE}}var endOfCentralDirectorySize=0;if(self.forceZip64Eocd||self.entries.length>=65535||centralDirectorySize>=65535||pretendOutputCursor>=4294967295){endOfCentralDirectorySize+=ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE+ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE}endOfCentralDirectorySize+=END_OF_CENTRAL_DIRECTORY_RECORD_SIZE;return pretendOutputCursor+centralDirectorySize+endOfCentralDirectorySize}var ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE=56;var ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE=20;var END_OF_CENTRAL_DIRECTORY_RECORD_SIZE=22;function getEndOfCentralDirectoryRecord(self,actuallyJustTellMeHowLongItWouldBe){var needZip64Format=false;var normalEntriesLength=self.entries.length;if(self.forceZip64Eocd||self.entries.length>=65535){normalEntriesLength=65535;needZip64Format=true}var sizeOfCentralDirectory=self.outputStreamCursor-self.offsetOfStartOfCentralDirectory;var normalSizeOfCentralDirectory=sizeOfCentralDirectory;if(self.forceZip64Eocd||sizeOfCentralDirectory>=4294967295){normalSizeOfCentralDirectory=4294967295;needZip64Format=true}var normalOffsetOfStartOfCentralDirectory=self.offsetOfStartOfCentralDirectory;if(self.forceZip64Eocd||self.offsetOfStartOfCentralDirectory>=4294967295){normalOffsetOfStartOfCentralDirectory=4294967295;needZip64Format=true}if(actuallyJustTellMeHowLongItWouldBe){if(needZip64Format){return ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE+ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE+END_OF_CENTRAL_DIRECTORY_RECORD_SIZE}else{return END_OF_CENTRAL_DIRECTORY_RECORD_SIZE}}var eocdrBuffer=Buffer.alloc(END_OF_CENTRAL_DIRECTORY_RECORD_SIZE);eocdrBuffer.writeUInt32LE(101010256,0);eocdrBuffer.writeUInt16LE(0,4);eocdrBuffer.writeUInt16LE(0,6);eocdrBuffer.writeUInt16LE(normalEntriesLength,8);eocdrBuffer.writeUInt16LE(normalEntriesLength,10);eocdrBuffer.writeUInt32LE(normalSizeOfCentralDirectory,12);eocdrBuffer.writeUInt32LE(normalOffsetOfStartOfCentralDirectory,16);eocdrBuffer.writeUInt16LE(0,20);if(!needZip64Format)return eocdrBuffer;var zip64EocdrBuffer=Buffer.alloc(ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE);zip64EocdrBuffer.writeUInt32LE(101075792,0);writeUInt64LE(zip64EocdrBuffer,ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE-12,4);zip64EocdrBuffer.writeUInt16LE(VERSION_MADE_BY,12);zip64EocdrBuffer.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT_ZIP64,14);zip64EocdrBuffer.writeUInt32LE(0,16);zip64EocdrBuffer.writeUInt32LE(0,20);writeUInt64LE(zip64EocdrBuffer,self.entries.length,24);writeUInt64LE(zip64EocdrBuffer,self.entries.length,32);writeUInt64LE(zip64EocdrBuffer,sizeOfCentralDirectory,40);writeUInt64LE(zip64EocdrBuffer,self.offsetOfStartOfCentralDirectory,48);var zip64EocdlBuffer=Buffer.alloc(ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE);zip64EocdlBuffer.writeUInt32LE(117853008,0);zip64EocdlBuffer.writeUInt32LE(0,4);writeUInt64LE(zip64EocdlBuffer,self.outputStreamCursor,8);zip64EocdlBuffer.writeUInt32LE(1,16);return Buffer.concat([zip64EocdrBuffer,zip64EocdlBuffer,eocdrBuffer])}function validateMetadataPath(metadataPath,isDirectory){if(metadataPath==="")throw new Error("empty metadataPath");metadataPath=metadataPath.replace(/\\/g,"/");if(/^[a-zA-Z]:/.test(metadataPath)||/^\//.test(metadataPath))throw new Error("absolute path: "+metadataPath);if(metadataPath.split("/").indexOf("..")!==-1)throw new Error("invalid relative path: "+metadataPath);var looksLikeDirectory=/\/$/.test(metadataPath);if(isDirectory){if(!looksLikeDirectory)metadataPath+="/"}else{if(looksLikeDirectory)throw new Error("file path cannot end with '/': "+metadataPath)}return metadataPath}var defaultFileMode=parseInt("0100664",8);var defaultDirectoryMode=parseInt("040775",8);function Entry(metadataPath,isDirectory,options){this.utf8FileName=Buffer.from(metadataPath);if(this.utf8FileName.length>65535)throw new Error("utf8 file name too long. "+utf8FileName.length+" > "+65535);this.isDirectory=isDirectory;this.state=Entry.WAITING_FOR_METADATA;this.setLastModDate(options.mtime!=null?options.mtime:new Date);if(options.mode!=null){this.setFileAttributesMode(options.mode)}else{this.setFileAttributesMode(isDirectory?defaultDirectoryMode:defaultFileMode)}if(isDirectory){this.crcAndFileSizeKnown=true;this.crc32=0;this.uncompressedSize=0;this.compressedSize=0}else{this.crcAndFileSizeKnown=false;this.crc32=null;this.uncompressedSize=null;this.compressedSize=null;if(options.size!=null)this.uncompressedSize=options.size}if(isDirectory){this.compress=false}else{this.compress=true;if(options.compress!=null)this.compress=!!options.compress}this.forceZip64Format=!!options.forceZip64Format}Entry.WAITING_FOR_METADATA=0;Entry.READY_TO_PUMP_FILE_DATA=1;Entry.FILE_DATA_IN_PROGRESS=2;Entry.FILE_DATA_DONE=3;Entry.prototype.setLastModDate=function(date){var dosDateTime=dateToDosDateTime(date);this.lastModFileTime=dosDateTime.time;this.lastModFileDate=dosDateTime.date};Entry.prototype.setFileAttributesMode=function(mode){if((mode&65535)!==mode)throw new Error("invalid mode. expected: 0 <= "+mode+" <= "+65535);this.externalFileAttributes=mode<<16>>>0};Entry.prototype.setFileDataPumpFunction=function(doFileDataPump){this.doFileDataPump=doFileDataPump;this.state=Entry.READY_TO_PUMP_FILE_DATA};Entry.prototype.useZip64Format=function(){return this.forceZip64Format||this.uncompressedSize!=null&&this.uncompressedSize>4294967294||this.compressedSize!=null&&this.compressedSize>4294967294||this.relativeOffsetOfLocalHeader!=null&&this.relativeOffsetOfLocalHeader>4294967294};var LOCAL_FILE_HEADER_FIXED_SIZE=30;var VERSION_NEEDED_TO_EXTRACT_UTF8=20;var VERSION_NEEDED_TO_EXTRACT_ZIP64=45;var VERSION_MADE_BY=3<<8|63;var FILE_NAME_IS_UTF8=1<<11;var UNKNOWN_CRC32_AND_FILE_SIZES=1<<3;Entry.prototype.getLocalFileHeader=function(){var crc32=0;var compressedSize=0;var uncompressedSize=0;if(this.crcAndFileSizeKnown){crc32=this.crc32;compressedSize=this.compressedSize;uncompressedSize=this.uncompressedSize}var fixedSizeStuff=Buffer.alloc(LOCAL_FILE_HEADER_FIXED_SIZE);var generalPurposeBitFlag=FILE_NAME_IS_UTF8;if(!this.crcAndFileSizeKnown)generalPurposeBitFlag|=UNKNOWN_CRC32_AND_FILE_SIZES;fixedSizeStuff.writeUInt32LE(67324752,0);fixedSizeStuff.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT_UTF8,4);fixedSizeStuff.writeUInt16LE(generalPurposeBitFlag,6);fixedSizeStuff.writeUInt16LE(this.getCompressionMethod(),8);fixedSizeStuff.writeUInt16LE(this.lastModFileTime,10);fixedSizeStuff.writeUInt16LE(this.lastModFileDate,12);fixedSizeStuff.writeUInt32LE(crc32,14);fixedSizeStuff.writeUInt32LE(compressedSize,18);fixedSizeStuff.writeUInt32LE(uncompressedSize,22);fixedSizeStuff.writeUInt16LE(this.utf8FileName.length,26);fixedSizeStuff.writeUInt16LE(0,28);return Buffer.concat([fixedSizeStuff,this.utf8FileName])};var DATA_DESCRIPTOR_SIZE=16;var ZIP64_DATA_DESCRIPTOR_SIZE=24;Entry.prototype.getDataDescriptor=function(){if(this.crcAndFileSizeKnown){return Buffer.alloc(0)}if(!this.useZip64Format()){var buffer=Buffer.alloc(DATA_DESCRIPTOR_SIZE);buffer.writeUInt32LE(134695760,0);buffer.writeUInt32LE(this.crc32,4);buffer.writeUInt32LE(this.compressedSize,8);buffer.writeUInt32LE(this.uncompressedSize,12);return buffer}else{var buffer=Buffer.alloc(ZIP64_DATA_DESCRIPTOR_SIZE);buffer.writeUInt32LE(134695760,0);buffer.writeUInt32LE(this.crc32,4);writeUInt64LE(buffer,this.compressedSize,8);writeUInt64LE(buffer,this.uncompressedSize,16);return buffer}};var CENTRAL_DIRECTORY_RECORD_FIXED_SIZE=46;var ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_SIZE=28;Entry.prototype.getCentralDirectoryRecord=function(){var fixedSizeStuff=Buffer.alloc(CENTRAL_DIRECTORY_RECORD_FIXED_SIZE);var generalPurposeBitFlag=FILE_NAME_IS_UTF8;if(!this.crcAndFileSizeKnown)generalPurposeBitFlag|=UNKNOWN_CRC32_AND_FILE_SIZES;var normalCompressedSize=this.compressedSize;var normalUncompressedSize=this.uncompressedSize;var normalRelativeOffsetOfLocalHeader=this.relativeOffsetOfLocalHeader;var versionNeededToExtract;var zeiefBuffer;if(this.useZip64Format()){normalCompressedSize=4294967295;normalUncompressedSize=4294967295;normalRelativeOffsetOfLocalHeader=4294967295;versionNeededToExtract=VERSION_NEEDED_TO_EXTRACT_ZIP64;zeiefBuffer=Buffer.alloc(ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_SIZE);zeiefBuffer.writeUInt16LE(1,0);zeiefBuffer.writeUInt16LE(ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_SIZE-4,2);writeUInt64LE(zeiefBuffer,this.uncompressedSize,4);writeUInt64LE(zeiefBuffer,this.compressedSize,12);writeUInt64LE(zeiefBuffer,this.relativeOffsetOfLocalHeader,20)}else{versionNeededToExtract=VERSION_NEEDED_TO_EXTRACT_UTF8;zeiefBuffer=Buffer.alloc(0)}fixedSizeStuff.writeUInt32LE(33639248,0);fixedSizeStuff.writeUInt16LE(VERSION_MADE_BY,4);fixedSizeStuff.writeUInt16LE(versionNeededToExtract,6);fixedSizeStuff.writeUInt16LE(generalPurposeBitFlag,8);fixedSizeStuff.writeUInt16LE(this.getCompressionMethod(),10);fixedSizeStuff.writeUInt16LE(this.lastModFileTime,12);fixedSizeStuff.writeUInt16LE(this.lastModFileDate,14);fixedSizeStuff.writeUInt32LE(this.crc32,16);fixedSizeStuff.writeUInt32LE(normalCompressedSize,20);fixedSizeStuff.writeUInt32LE(normalUncompressedSize,24);fixedSizeStuff.writeUInt16LE(this.utf8FileName.length,28);fixedSizeStuff.writeUInt16LE(zeiefBuffer.length,30);fixedSizeStuff.writeUInt16LE(0,32);fixedSizeStuff.writeUInt16LE(0,34);fixedSizeStuff.writeUInt16LE(0,36);fixedSizeStuff.writeUInt32LE(this.externalFileAttributes,38);fixedSizeStuff.writeUInt32LE(normalRelativeOffsetOfLocalHeader,42);return Buffer.concat([fixedSizeStuff,this.utf8FileName,zeiefBuffer])};Entry.prototype.getCompressionMethod=function(){var NO_COMPRESSION=0;var DEFLATE_COMPRESSION=8;return this.compress?DEFLATE_COMPRESSION:NO_COMPRESSION};function dateToDosDateTime(jsDate){var date=0;date|=jsDate.getDate()&31;date|=(jsDate.getMonth()+1&15)<<5;date|=(jsDate.getFullYear()-1980&127)<<9;var time=0;time|=Math.floor(jsDate.getSeconds()/2);time|=(jsDate.getMinutes()&63)<<5;time|=(jsDate.getHours()&31)<<11;return{date:date,time:time}}function writeUInt64LE(buffer,n,offset){var high=Math.floor(n/4294967296);var low=n%4294967296;buffer.writeUInt32LE(low,offset);buffer.writeUInt32LE(high,offset+4)}function defaultCallback(err){if(err)throw err}util.inherits(ByteCounter,Transform);function ByteCounter(options){Transform.call(this,options);this.byteCount=0}ByteCounter.prototype._transform=function(chunk,encoding,cb){this.byteCount+=chunk.length;cb(null,chunk)};util.inherits(Crc32Watcher,Transform);function Crc32Watcher(options){Transform.call(this,options);this.crc32=0}Crc32Watcher.prototype._transform=function(chunk,encoding,cb){this.crc32=crc32.unsigned(chunk,this.crc32);cb(null,chunk)}},{"buffer-crc32":2,events:undefined,fs:undefined,stream:undefined,util:undefined,zlib:undefined}],2:[function(require,module,exports){var Buffer=require("buffer").Buffer;var CRC_TABLE=[0,1996959894,3993919788,2567524794,124634137,1886057615,3915621685,2657392035,249268274,2044508324,3772115230,2547177864,162941995,2125561021,3887607047,2428444049,498536548,1789927666,4089016648,2227061214,450548861,1843258603,4107580753,2211677639,325883990,1684777152,4251122042,2321926636,335633487,1661365465,4195302755,2366115317,997073096,1281953886,3579855332,2724688242,1006888145,1258607687,3524101629,2768942443,901097722,1119000684,3686517206,2898065728,853044451,1172266101,3705015759,2882616665,651767980,1373503546,3369554304,3218104598,565507253,1454621731,3485111705,3099436303,671266974,1594198024,3322730930,2970347812,795835527,1483230225,3244367275,3060149565,1994146192,31158534,2563907772,4023717930,1907459465,112637215,2680153253,3904427059,2013776290,251722036,2517215374,3775830040,2137656763,141376813,2439277719,3865271297,1802195444,476864866,2238001368,4066508878,1812370925,453092731,2181625025,4111451223,1706088902,314042704,2344532202,4240017532,1658658271,366619977,2362670323,4224994405,1303535960,984961486,2747007092,3569037538,1256170817,1037604311,2765210733,3554079995,1131014506,879679996,2909243462,3663771856,1141124467,855842277,2852801631,3708648649,1342533948,654459306,3188396048,3373015174,1466479909,544179635,3110523913,3462522015,1591671054,702138776,2966460450,3352799412,1504918807,783551873,3082640443,3233442989,3988292384,2596254646,62317068,1957810842,3939845945,2647816111,81470997,1943803523,3814918930,2489596804,225274430,2053790376,3826175755,2466906013,167816743,2097651377,4027552580,2265490386,503444072,1762050814,4150417245,2154129355,426522225,1852507879,4275313526,2312317920,282753626,1742555852,4189708143,2394877945,397917763,1622183637,3604390888,2714866558,953729732,1340076626,3518719985,2797360999,1068828381,1219638859,3624741850,2936675148,906185462,1090812512,3747672003,2825379669,829329135,1181335161,3412177804,3160834842,628085408,1382605366,3423369109,3138078467,570562233,1426400815,3317316542,2998733608,733239954,1555261956,3268935591,3050360625,752459403,1541320221,2607071920,3965973030,1969922972,40735498,2617837225,3943577151,1913087877,83908371,2512341634,3803740692,2075208622,213261112,2463272603,3855990285,2094854071,198958881,2262029012,4057260610,1759359992,534414190,2176718541,4139329115,1873836001,414664567,2282248934,4279200368,1711684554,285281116,2405801727,4167216745,1634467795,376229701,2685067896,3608007406,1308918612,956543938,2808555105,3495958263,1231636301,1047427035,2932959818,3654703836,1088359270,936918e3,2847714899,3736837829,1202900863,817233897,3183342108,3401237130,1404277552,615818150,3134207493,3453421203,1423857449,601450431,3009837614,3294710456,1567103746,711928724,3020668471,3272380065,1510334235,755167117];if(typeof Int32Array!=="undefined"){CRC_TABLE=new Int32Array(CRC_TABLE)}function ensureBuffer(input){if(Buffer.isBuffer(input)){return input}var hasNewBufferAPI=typeof Buffer.alloc==="function"&&typeof Buffer.from==="function";if(typeof input==="number"){return hasNewBufferAPI?Buffer.alloc(input):new Buffer(input)}else if(typeof input==="string"){return hasNewBufferAPI?Buffer.from(input):new Buffer(input)}else{throw new Error("input must be buffer, number, or string, received "+typeof input)}}function bufferizeInt(num){var tmp=ensureBuffer(4);tmp.writeInt32BE(num,0);return tmp}function _crc32(buf,previous){buf=ensureBuffer(buf);if(Buffer.isBuffer(previous)){previous=previous.readUInt32BE(0)}var crc=~~previous^-1;for(var n=0;n<buf.length;n++){crc=CRC_TABLE[(crc^buf[n])&255]^crc>>>8}return crc^-1}function crc32(){return bufferizeInt(_crc32.apply(null,arguments))}crc32.signed=function(){return _crc32.apply(null,arguments)};crc32.unsigned=function(){return _crc32.apply(null,arguments)>>>0};module.exports=crc32},{buffer:undefined}]},{},[1])(1)});
